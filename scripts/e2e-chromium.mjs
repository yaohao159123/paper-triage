// End-to-end check in a real Chromium (Playwright's "Chrome for Testing"; branded Chrome 137+ ignores --load-extension).
// Serves the fixture pages over local HTTPS under the real hostnames via --host-resolver-rules, loads the unpacked
// extension, seeds the API key, opens each page, waits for verdict badges, screenshots, and asserts counts.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import https from 'node:https';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'e2e-out');
const CERTS = path.join(ROOT, 'tests', 'e2e-certs');
const PORT = 8443;
const CDP_PORT = 9556;
const CHROME = process.env.PT_CHROMIUM || `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const HEADED = process.argv.includes('--headed');

const PAGES = [
  { host: 'scholar.google.com', path: '/scholar?hl=en&q=microwave+dielectric+properties+biomass', fixture: 'scholar.html', expectMin: 10, toolbar: true },
  { host: 'arxiv.org', path: '/list/cond-mat.mtrl-sci/new', fixture: 'arxiv-list.html', expectMin: 45, scrollTo: 'dl', toolbar: true, expectRuns: true },
  { host: 'arxiv.org', path: '/abs/2609.22268', pathPrefix: '/abs/', fixture: 'arxiv-abs.html', expectMin: 1, single: true },
  { host: 'pubmed.ncbi.nlm.nih.gov', path: '/?term=microwave+dielectric+biomass', fixture: 'pubmed.html', expectMin: 2, toolbar: true },
  { host: 'x.com', path: '/home', fixture: 'x-home.html', expectMin: 4, toolbar: true, xCollapse: true },
  { host: 'www.xiaohongshu.com', path: '/explore', fixture: 'xhs-explore.html', expectMin: 6, toolbar: true, masonry: true },
  { host: 'www.xiaohongshu.com', path: '/explore/6a85231600000000050283d8?xsec_token=AB2', pathPrefix: '/explore/6a', fixture: 'xhs-note.html', expectMin: 2, toolbar: true, masonry: true, modal: true },
];

function apiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  return JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, 'utf8')).env?.TYPESAFE_API_KEY || '';
}

function ensureCerts() {
  mkdirSync(CERTS, { recursive: true });
  const key = path.join(CERTS, 'key.pem');
  const cert = path.join(CERTS, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${key}" -out "${cert}" -subj "/CN=paper-triage-e2e" -days 3650`, { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function startServer() {
  const server = https.createServer(ensureCerts(), (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const candidates = PAGES.filter((p) => p.host === host);
    const page = candidates.find((p) => p.pathPrefix && req.url.startsWith(p.pathPrefix)) || candidates.find((p) => !p.pathPrefix);
    if (!page || req.url.startsWith('/scholar_') || /\.(js|css|png|ico|svg|woff2?)(\?|$)/.test(req.url)) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(path.join(ROOT, 'tests', 'fixtures', page.fixture)));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data)); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); return new CDP(ws); }
  onMessage(m) {
    if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    else for (const l of this.listeners) l(m);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.listeners.push(fn); }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 45000, every = 500 } = {}) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error('timeout'); await sleep(every); }
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chromium not found at ${CHROME}`);
  const key = apiKey();
  if (!key) throw new Error('no TYPESAFE_API_KEY');
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const profile = `/tmp/pt-e2e-profile-${Date.now()}`;
  const args = [
    ...(HEADED ? [] : ['--headless=new']),
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`,
    `--host-resolver-rules=${[...new Set(PAGES.map((p) => p.host))].map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`,
    '--ignore-certificate-errors', '--window-size=1280,900', '--lang=en-US', 'about:blank',
  ];
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  const summary = [];
  let failed = false;
  try {
    const version = await waitFor(async () => { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch { return null; } });
    const cdp = await CDP.connect(version.webSocketDebuggerUrl);
    // 1. find the extension's service worker and seed settings
    const sw = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')));
    const extId = new URL(sw.url).host;
    // chrome.* is not exposed to CDP sessions on the worker or on extension pages in headless mode,
    // but the content script's isolated world on a matched page has chrome.storage. Seed through it.
    {
      const { targetId } = await cdp.send('Target.createTarget', { url: `https://${PAGES[0].host}${PAGES[0].path}` });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const contexts = [];
      cdp.on((m) => { if (m.sessionId === sessionId && m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context); });
      await cdp.send('Runtime.enable', {}, sessionId);
      const isolated = await waitFor(async () => contexts.find((c) => c.auxData?.isDefault === false), { timeout: 15000, every: 200 });
      const seed = await cdp.send('Runtime.evaluate', { contextId: isolated.id, expression: `chrome.storage.local.set({settings:{apiKey:${JSON.stringify(key)},enabled:true}}).then(() => chrome.storage.local.get('settings')).then(s => !!s.settings?.apiKey)`, awaitPromise: true, returnByValue: true }, sessionId);
      if (seed.exceptionDetails || seed.result?.value !== true) throw new Error(`seeding settings failed: ${JSON.stringify(seed)}`);
      await cdp.send('Target.closeTarget', { targetId });
    }
    console.log(`extension ${extId} loaded, settings seeded`);
    // 2. each page
    for (const page of PAGES) {
      const url = `https://${page.host}${page.path}`;
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      const evalIn = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
      const t0 = Date.now();
      let counts;
      try {
        counts = await waitFor(async () => {
          const c = await evalIn(`(() => { const q = (s) => document.querySelectorAll(s).length; return { badges: q('.pt-badge'), loading: q('.pt-loading'), error: q('.pt-error'), follow: q('.pt-follow'), normal: q('.pt-normal'), skip: q('.pt-skip'), skipped: q('[data-pt-skipped]') }; })()`);
          return c.badges >= page.expectMin && c.loading === 0 ? c : null;
        });
      } catch (err) {
        counts = await evalIn(`(() => { const q = (s) => document.querySelectorAll(s).length; return { badges: q('.pt-badge'), loading: q('.pt-loading'), error: q('.pt-error'), follow: q('.pt-follow'), normal: q('.pt-normal'), skip: q('.pt-skip'), skipped: q('[data-pt-skipped]') }; })()`);
        failed = true;
      }
      const ms = Date.now() - t0;
      const sample = await evalIn(`[...document.querySelectorAll('.pt-badge')].slice(0, 6).map(b => b.textContent + (b.nextElementSibling?.classList.contains('pt-review') ? '+' + b.nextElementSibling.textContent : '') + ' | ' + (b.closest('[data-pt-key]')?.querySelector('.gs_rt, .list-title, .docsum-title, h1, [data-testid="tweetText"]')?.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 70))`);
      const errTitles = await evalIn(`[...document.querySelectorAll('.pt-error')].slice(0, 3).map(b => b.title)`);
      await evalIn(page.scrollTo ? `document.querySelector(${JSON.stringify(page.scrollTo)})?.scrollIntoView()` : 'window.scrollTo(0, 0)');
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      const file = path.join(OUT, `${page.host}${page.pathPrefix ? '-abs' : ''}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      const siteChecks = await evalIn(`(() => {
        const html = document.documentElement;
        const out = { skipMode: html.dataset.ptSkip };
        if (${page.xCollapse ? 'true' : 'false'}) { const a = document.querySelector('article[data-pt-skipped]'); out.mediaHidden = a ? [...document.querySelectorAll('article[data-pt-skipped] :is([data-testid="tweetPhoto"], div[role="link"], [data-testid="article-cover-image"], [role="group"])')].every(el => getComputedStyle(el).display === 'none') : null; out.quoteBlocks = document.querySelectorAll('article[data-pt-skipped] div[role="link"]').length; out.collapsedHeight = a ? Math.round(a.getBoundingClientRect().height) : null; out.textClamped = a ? getComputedStyle(a.querySelector('[data-testid="tweetText"]')).webkitLineClamp === '1' : null; }
        if (${page.masonry ? 'true' : 'false'}) { const feed = document.querySelector('#exploreFeeds'); const cards = [...feed.querySelectorAll('section.note-item')]; out.relayout = feed.dataset.ptRelayout === '1'; out.hidden = cards.filter(c => getComputedStyle(c).display === 'none').length; out.visiblePositions = cards.filter(c => getComputedStyle(c).display !== 'none').map(c => c.style.transform); out.feedHeight = feed.style.height; }
        return out; })()`);
      if (page.masonry && !page.modal) {
        // 只看关注 on the masonry: non-follow cards hidden, grid re-packed; then the site "re-lays out" a card and we must undo it
        const fo = await evalIn(`(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const feed = document.querySelector('#exploreFeeds'); const cards = () => [...feed.querySelectorAll('section.note-item')];
          document.querySelector('.pt-toolbar [data-action="followonly"]').click(); await sleep(300);
          const visible = () => cards().filter(c => getComputedStyle(c).display !== 'none');
          const out = { followOnly: !!document.documentElement.dataset.ptFollowOnly, visible: visible().length, visibleLabels: visible().map(c => c.dataset.ptLabel), positions: visible().map(c => c.style.transform) };
          const victim = visible()[0]; victim.style.transform = 'translate(999px, 999px)'; await sleep(500);
          out.afterSiteMove = victim.style.transform; out.distinct = new Set(visible().map(c => c.style.transform)).size === visible().length;
          document.querySelector('.pt-toolbar [data-action="followonly"]').click(); await sleep(300);
          out.restoredVisible = visible().length;
          return out; })()`);
        siteChecks.followOnly = fo;
        siteChecks.followOnlyOk = fo.followOnly && fo.visibleLabels.every((l) => l === 'follow') && fo.visible === counts.follow && fo.afterSiteMove !== 'translate(999px, 999px)' && fo.distinct && fo.restoredVisible > fo.visible;
      }
      if (page.modal) {
        const md = await evalIn(`(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('.pt-toolbar [data-action="followonly"]').click(); await sleep(300); const t = document.querySelector('#detail-title'); const out = { titleLabel: t?.dataset.ptLabel, titleVisible: t ? getComputedStyle(t).display !== 'none' : null, single: t?.dataset.ptSingle }; document.querySelector('.pt-toolbar [data-action="followonly"]').click(); return out; })()`);
        siteChecks.modal = md;
        siteChecks.modalOk = md.titleVisible === true && md.single === '1';
      }
      const siteOk = (!page.xCollapse || (siteChecks.skipMode === 'collapse' && siteChecks.mediaHidden !== false && siteChecks.textClamped === true))
        && (!page.masonry || (siteChecks.skipMode === 'hide' && siteChecks.relayout === true && siteChecks.hidden === counts.skip && new Set(siteChecks.visiblePositions).size === siteChecks.visiblePositions.length))
        && (!(page.masonry && !page.modal) || siteChecks.followOnlyOk === true)
        && (!page.modal || siteChecks.modalOk === true);
      // toolbar checks on list pages: collapse markers, hide mode hides skipped entries, reasons shown, sort moves 关注 first
      const tb = await evalIn(`(async () => {
        const t = document.querySelector('.pt-toolbar'); if (!t) return null;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const skipped = () => [...document.querySelectorAll('[data-pt-key][data-pt-label="skip"]')];
        const out = { counts: t.querySelector('.pt-tb-counts').textContent, runs: document.querySelectorAll('.pt-run').length, reasons: document.querySelectorAll('.pt-reasons').length, collapsed: document.documentElement.dataset.ptSkip === 'collapse' };
        const sel = t.querySelector('.pt-tb-skipmode'); sel.value = 'hide'; sel.dispatchEvent(new Event('change')); await sleep(400);
        out.hiddenInHideMode = skipped().filter(el => getComputedStyle(el).display === 'none').length;
        sel.value = 'collapse'; sel.dispatchEvent(new Event('change')); await sleep(400);
        out.hiddenInCollapseMode = skipped().filter(el => getComputedStyle(el).display === 'none').length;
        sel.value = ${JSON.stringify(page.masonry ? 'hide' : 'collapse')}; sel.dispatchEvent(new Event('change')); await sleep(300); // back to the site default so later pages see it
        out.noticeHiddenWhenOff = document.querySelector('.pt-notice')?.hidden === true;
        const sortBtn = t.querySelector('[data-action="sort"]');
        if (sortBtn) { sortBtn.click(); await sleep(400); const order = [...document.querySelectorAll('[data-pt-key]')].map(el => el.dataset.ptLabel); out.sortedFirst = order[0]; out.sortedFollowBeforeSkip = order.lastIndexOf('follow') < (order.indexOf('skip') === -1 ? Infinity : order.indexOf('skip')); sortBtn.click(); await sleep(300); }
        return out;
      })()`);
      // 只看关注 through the keyboard exactly as macOS reports Option+F (key "ƒ", code KeyF), then the notice pill and its 「显示全部」 exit
      let kb = null;
      if (page.host === 'scholar.google.com') {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ƒ', code: 'KeyF', modifiers: 1, windowsVirtualKeyCode: 70 }, sessionId);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ƒ', code: 'KeyF', modifiers: 1, windowsVirtualKeyCode: 70 }, sessionId);
        await sleep(300);
        kb = await evalIn(`(() => { const n = document.querySelector('.pt-notice'); const vis = [...document.querySelectorAll('[data-pt-key]')].filter(el => getComputedStyle(el).display !== 'none'); return { followOnly: !!document.documentElement.dataset.ptFollowOnly, noticeShown: !!n && !n.hidden && getComputedStyle(n).display !== 'none', noticeText: n?.textContent, visibleLabels: [...new Set(vis.map(el => el.dataset.ptLabel))] }; })()`);
        await evalIn(`document.querySelector('.pt-notice [data-action="showall"]').click()`); await sleep(200);
        kb.offAfterShowAll = await evalIn(`!document.documentElement.dataset.ptFollowOnly && document.querySelector('.pt-notice').hidden`);
        const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(path.join(OUT, `${page.host}-followonly.png`), Buffer.from(shot2.data, 'base64'));
        if (kb) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ƒ', code: 'KeyF', modifiers: 1 }, sessionId); await sleep(200); const s3 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId); writeFileSync(path.join(OUT, `${page.host}-followonly.png`), Buffer.from(s3.data, 'base64')); await evalIn(`document.querySelector('.pt-notice [data-action="showall"]').click()`); }
        tb.keyboard = kb;
      }
      const kbOk = !kb || (kb.followOnly && kb.noticeShown && /只看关注：显示 \d+ 条关注 · 隐藏 \d+ 条/.test(kb.noticeText) && kb.visibleLabels.every((l) => l === 'follow') && kb.offAfterShowAll === true);
      const toolbarOk = page.toolbar
        ? !!tb && (tb.collapsed || page.masonry) && tb.hiddenInHideMode === counts.skipped && (!page.expectRuns || tb.runs >= 1) && (page.host === 'x.com' || tb.sortedFollowBeforeSkip !== false) && tb.noticeHiddenWhenOff === true && kbOk
        : tb === null;
      const singleOk = !page.single || (counts.skipped === 0 && counts.badges === 1);
      if (page.modal) counts.skip = counts.skipped; // the modal entry is single: never greyed
      const ok = counts.badges >= page.expectMin && counts.error === 0 && counts.loading === 0 && counts.skipped >= counts.skip && toolbarOk && singleOk && siteOk; // arXiv greys dt+dd per entry
      if (!ok) failed = true;
      summary.push({ host: page.host + (page.pathPrefix || ''), ok, ms, ...counts, toolbar: tb, site: siteChecks, screenshot: file, sample, errTitles });
      // 3. manual override on the first badge: click cycles, alt-click restores
      if (page.host === 'scholar.google.com' && counts.badges) {
        const before = await evalIn(`document.querySelector('.pt-badge').textContent`);
        const badgeState = () => evalIn(`document.querySelector('.pt-badge').textContent + '|' + document.querySelector('.pt-badge').classList.contains('pt-manual')`);
        await evalIn(`document.querySelector('.pt-badge').click()`);
        const after = await waitFor(async () => { const v = await badgeState(); return v !== `${before}|false` ? v : null; }, { timeout: 5000, every: 100 });
        await evalIn(`document.querySelector('.pt-badge').dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, altKey:true}))`);
        const restored = await waitFor(async () => { const v = await badgeState(); return v === `${before}|false` ? v : null; }, { timeout: 5000, every: 100 }).catch(async () => badgeState());
        summary.push({ host: 'override-check', before, after, restored, ok: after.endsWith('true') && restored === `${before}|false` });
        if (!(after.endsWith('true') && restored === `${before}|false`)) failed = true;
      }
      await cdp.send('Target.closeTarget', { targetId });
    }
    cdp.close();
  } finally {
    chrome.kill('SIGKILL');
    server.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(failed ? 'E2E FAILED' : 'E2E OK');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
