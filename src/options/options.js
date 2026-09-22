import { DEFAULT_PROFILE, DEFAULT_THRESHOLDS, DEFAULT_BATCH_SIZE, DEFAULT_MODEL_NAME, linesToList, listToLines } from '../shared/profile.js';

const $ = (id) => document.getElementById(id);
const LIST_FIELDS = ['core_topics', 'methods', 'materials', 'not_interested'];

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: { message: chrome.runtime.lastError?.message } })));
}

function fillProfile(profile) {
  $('summary').value = profile.summary || '';
  for (const f of LIST_FIELDS) $(f).value = listToLines(profile[f]);
}

function readProfile() {
  const p = { summary: $('summary').value.trim() };
  for (const f of LIST_FIELDS) p[f] = linesToList($(f).value);
  return p;
}

function clamp01(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

async function load() {
  const s = await send({ type: 'getSettings' });
  $('apiKey').value = s.apiKey || '';
  $('model').value = s.model || DEFAULT_MODEL_NAME;
  fillProfile({ ...DEFAULT_PROFILE, ...(s.profile || {}) });
  $('followMin').value = s.thresholds?.followMin ?? DEFAULT_THRESHOLDS.followMin;
  $('skipMin').value = s.thresholds?.skipMin ?? DEFAULT_THRESHOLDS.skipMin;
  $('batchSize').value = s.batchSize ?? DEFAULT_BATCH_SIZE;
  await refreshStats();
}

async function refreshStats() {
  const st = await send({ type: 'stats' });
  $('stats').textContent = st.ok ? `已缓存 ${st.total} 篇：关注 ${st.follow} · 普通 ${st.normal} · 跳过 ${st.skip}（手动改判 ${st.manual}）` : '无法读取缓存';
}

function flash(el, text, ok) {
  el.textContent = text;
  el.className = `status ${ok ? 'ok' : 'err'}`;
}

$('save').addEventListener('click', async () => {
  const patch = {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || DEFAULT_MODEL_NAME,
    profile: readProfile(),
    thresholds: { followMin: clamp01($('followMin').value, DEFAULT_THRESHOLDS.followMin), skipMin: clamp01($('skipMin').value, DEFAULT_THRESHOLDS.skipMin) },
    batchSize: Math.max(1, Math.min(20, Number($('batchSize').value) || DEFAULT_BATCH_SIZE)),
  };
  const r = await send({ type: 'setSettings', patch });
  flash($('saveStatus'), r.ok ? '已保存。已判读过的文献沿用缓存；想按新画像重判请清空缓存或在页面弹窗点「本页重新判读」。' : `保存失败：${r.error?.message}`, r.ok);
});

$('ping').addEventListener('click', async () => {
  flash($('pingStatus'), '连接中…', true);
  const r = await send({ type: 'ping', apiKey: $('apiKey').value.trim() });
  if (r.ok) {
    const names = (r.models?.data || r.models?.models || []).map((m) => m.id || m.name).filter(Boolean);
    flash($('pingStatus'), `连接成功${names.length ? `，可用模型：${names.join(', ')}` : ''}`, true);
  } else flash($('pingStatus'), `连接失败：${r.message || r.error?.message}`, false);
});

$('resetProfile').addEventListener('click', () => fillProfile(DEFAULT_PROFILE));

$('clearCache').addEventListener('click', async () => {
  if (!confirm('清空所有已判读结果（含手动改判）？')) return;
  const r = await send({ type: 'clearCache' });
  flash($('saveStatus'), r.ok ? `已清空 ${r.removed} 条缓存` : '清空失败', r.ok);
  await refreshStats();
});

load();
