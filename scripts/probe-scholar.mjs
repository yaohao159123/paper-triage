// Probe: run the extension against the REAL Google Scholar in headless Chromium and walk a user's flow,
// logging what the extension sees at each step (visible entries, follow-only flag, counts, diagnostics).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'e2e-out', 'probe');
const CDP_PORT = 9557;
const CHROME = process.env.PT_CHROMIUM || `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const HEADED = process.argv.includes('--headed');
const Q1 = process.env.PT_Q1 || 'electric arc furnace dust zinc recovery biochar';
const Q2 = process.env.PT_Q2 || 'microwave dielectric properties biomass';

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data)); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); return new CDP(ws); }
  onMessage(m) { if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } else for (const l of this.listeners) l(m); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  on(fn) { this.listeners.push(fn); }
  close() { this.ws.close(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 45000, every = 400 } = {}) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error('timeout'); await sleep(every); } }
function apiKey() { return process.env.TYPESAFE_API_KEY || JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, 'utf8')).env?.TYPESAFE_API_KEY || ''; }

const SNAP = `(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const entries = q('div.gs_r.gs_or.gs_scl');
  const vis = (el) => getComputedStyle(el).display !== 'none';
  const html = document.documentElement;
  return {
    url: location.href.slice(0, 120), title: document.title.slice(0, 60),
    captcha: !!document.querySelector('#gs_captcha_ccl, #recaptcha, form[action*="sorry"]') || /sorry/.test(location.href),
    entries: entries.length, keyed: entries.filter(e => e.dataset.ptKey).length,
    labels: entries.map(e => e.dataset.ptLabel || (e.dataset.ptKey ? 'pending' : 'nokey')),
    visible: entries.filter(vis).length, visibleLabels: entries.filter(vis).map(e => e.dataset.ptLabel || 'pending'),
    badges: q('.pt-badge').length, loading: q('.pt-loading').length, error: q('.pt-error').length,
    followOnly: !!html.dataset.ptFollowOnly, skip: html.dataset.ptSkip, site: html.dataset.ptSite,
    toolbar: !!document.querySelector('.pt-toolbar'), toolbarActive: !!document.querySelector('.pt-toolbar [data-action="followonly"].pt-tb-active'),
    counts: document.querySelector('.pt-tb-counts')?.textContent, session: (() => { try { return sessionStorage.getItem('pt-follow-only'); } catch { return 'ERR'; } })(),
    errTitles: q('.pt-error').slice(0, 2).map(b => b.title),
  }; })()`;

async function main() {
  const key = apiKey(); if (!key) throw new Error('no key');
  mkdirSync(OUT, { recursive: true });
  const profile = `/tmp/pt-probe-profile-${Date.now()}`;
  const args = [...(HEADED ? [] : ['--headless=new']), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`, '--window-size=1280,900', '--lang=en-US', 'about:blank'];
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  const log = [];
  try {
    const version = await waitFor(async () => { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch { return null; } });
    const cdp = await CDP.connect(version.webSocketDebuggerUrl);
    await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')));
    const url1 = `https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(Q1)}`;
    const { targetId } = await cdp.send('Target.createTarget', { url: url1 });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const contexts = [];
    cdp.on((m) => { if (m.sessionId === sessionId && m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context); });
    const evalIn = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || '')); return r.result.value; };
    // seed the key through the content script's isolated world
    const isolated = await waitFor(async () => contexts.find((c) => c.auxData?.isDefault === false), { timeout: 20000, every: 200 });
    await cdp.send('Runtime.evaluate', { contextId: isolated.id, expression: `chrome.storage.local.set({settings:{apiKey:${JSON.stringify(key)},enabled:true}})`, awaitPromise: true }, sessionId);
    const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId); writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.data, 'base64')); };
    const step = async (name, extra = {}) => { const s = await evalIn(SNAP); log.push({ step: name, ...s, ...extra }); console.log(name, JSON.stringify({ entries: s.entries, keyed: s.keyed, visible: s.visible, visibleLabels: s.visibleLabels.join(','), badges: s.badges, loading: s.loading, error: s.error, followOnly: s.followOnly, active: s.toolbarActive, session: s.session, counts: s.counts, captcha: s.captcha })); await shot(name); return s; };
    const nav = async (url) => { const ctxBefore = contexts.length; await cdp.send('Page.navigate', { url }, sessionId); await waitFor(async () => contexts.length > ctxBefore, { timeout: 20000, every: 100 }); await sleep(300); };
    const settle = () => waitFor(async () => { const s = await evalIn(SNAP); return s.captcha || (s.badges > 0 && s.loading === 0) ? s : null; }, { timeout: 60000 });

    await sleep(1500);
    const s0 = await step('01-load');
    if (s0.captcha) { console.log('CAPTCHA on first load — cannot probe real Scholar'); return; }
    await settle(); await step('02-judged');
    // click 只看关注
    await evalIn(`document.querySelector('.pt-toolbar [data-action="followonly"]').click()`); await sleep(300);
    await step('03-followOnly-on');
    // reload the page with follow-only persisted (what a user sees paging / re-searching)
    await nav(`https://scholar.google.com/scholar?hl=en&start=10&q=${encodeURIComponent(Q1)}`);
    await sleep(400); await step('04-page2-early');
    await settle(); await step('05-page2-judged');
    // new search in the same tab
    await nav(`https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(Q2)}`);
    await sleep(400); await step('06-search2-early');
    await settle(); await step('07-search2-judged');
    // toggle off, then on, then off quickly
    await evalIn(`document.querySelector('.pt-toolbar [data-action="followonly"]').click()`); await sleep(300); await step('08-off');
    await evalIn(`document.querySelector('.pt-toolbar [data-action="followonly"]').click()`); await sleep(300); await step('09-on');
    await evalIn(`window.scrollTo(0, 600)`); await sleep(500); await step('10-on-scrolled');
    // keyboard toggle
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', modifiers: 1 }, sessionId); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', modifiers: 1 }, sessionId); await sleep(300); await step('11-altF');
    // back navigation (bfcache)
    await cdp.send('Page.navigateToHistoryEntry', { entryId: (await cdp.send('Page.getNavigationHistory', {}, sessionId)).entries.at(-2).id }, sessionId); await sleep(1500); await step('12-back');
    const diag = await cdp.send('Runtime.evaluate', { contextId: contexts.filter((c) => c.auxData?.isDefault === false).at(-1)?.id, expression: `new Promise(r => chrome.runtime.sendMessage({type:'ping'}, x => r(chrome.runtime.lastError?.message || JSON.stringify(x))))`, awaitPromise: true, returnByValue: true }, sessionId).catch((e) => ({ result: { value: String(e) } }));
    log.push({ step: 'bg-ping', value: diag.result?.value });
    cdp.close();
  } finally {
    chrome.kill('SIGKILL');
    writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
