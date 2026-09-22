import { DEFAULT_PROFILE, DEFAULT_TWEET_PROFILE, DEFAULT_THRESHOLDS, DEFAULT_BATCH_SIZE, DEFAULT_MODEL_NAME, DEFAULT_DISPLAY, linesToList, listToLines, newProfileId } from '../shared/profile.js';

const $ = (id) => document.getElementById(id);
const LIST_FIELDS = ['core_topics', 'methods', 'materials', 'not_interested'];
const TWEET_LIST_FIELDS = ['interests', 'useful_signals', 'noise'];
let profiles = [];
let activeProfileId = null;
let editingId = null;

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

function fillTweetProfile(tp) {
  $('t_summary').value = tp.summary || '';
  for (const f of TWEET_LIST_FIELDS) $(`t_${f}`).value = listToLines(tp[f]);
}

function readTweetProfile() {
  const p = { summary: $('t_summary').value.trim() };
  for (const f of TWEET_LIST_FIELDS) p[f] = linesToList($(`t_${f}`).value);
  return p;
}

/** Writes the form into the profile being edited, then re-renders the selector. */
function commitEditing() {
  const cur = profiles.find((p) => p.id === editingId);
  if (cur) Object.assign(cur, readProfile());
}

function renderProfileSelect() {
  const sel = $('profileSelect');
  sel.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.id === activeProfileId ? `${p.name}（当前生效）` : p.name;
    sel.appendChild(opt);
  }
  sel.value = editingId;
}

function switchEditing(id) {
  commitEditing();
  editingId = id;
  const p = profiles.find((x) => x.id === id) || profiles[0];
  fillProfile({ ...DEFAULT_PROFILE, ...p });
  renderProfileSelect();
}

function clamp01(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

async function load() {
  const s = await send({ type: 'getSettings' });
  $('apiKey').value = s.apiKey || '';
  $('model').value = s.model || DEFAULT_MODEL_NAME;
  profiles = (s.profiles || []).map((p) => ({ ...p }));
  activeProfileId = s.activeProfileId;
  editingId = activeProfileId;
  fillProfile({ ...DEFAULT_PROFILE, ...(profiles.find((p) => p.id === editingId) || {}) });
  renderProfileSelect();
  fillTweetProfile({ ...DEFAULT_TWEET_PROFILE, ...(s.tweetProfile || {}) });
  const d = { ...DEFAULT_DISPLAY, ...(s.display || {}) };
  $('skipMode').value = d.skipMode;
  $('followAccent').checked = d.followAccent !== false;
  $('reasons').checked = d.reasons !== false;
  $('sortFollowFirst').checked = !!d.sortFollowFirst;
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
  commitEditing();
  const patch = {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || DEFAULT_MODEL_NAME,
    profiles,
    activeProfileId,
    tweetProfile: readTweetProfile(),
    display: { skipMode: $('skipMode').value, followAccent: $('followAccent').checked, reasons: $('reasons').checked, sortFollowFirst: $('sortFollowFirst').checked },
    thresholds: { followMin: clamp01($('followMin').value, DEFAULT_THRESHOLDS.followMin), skipMin: clamp01($('skipMin').value, DEFAULT_THRESHOLDS.skipMin) },
    batchSize: Math.max(1, Math.min(20, Number($('batchSize').value) || DEFAULT_BATCH_SIZE)),
  };
  const r = await send({ type: 'setSettings', patch });
  flash($('saveStatus'), r.ok ? '已保存。画像改动会自动让旧判读失效（缓存按画像分开），已打开的页面会自动重判。' : `保存失败：${r.error?.message}`, r.ok);
});

$('profileSelect').addEventListener('change', (e) => switchEditing(e.target.value));
$('profileNew').addEventListener('click', () => {
  const name = prompt('新画像名称（例如：氢还原 / 冶金AGI）', '新画像');
  if (!name) return;
  commitEditing();
  const p = { id: newProfileId(), name: name.trim(), ...DEFAULT_PROFILE };
  profiles.push(p);
  activeProfileId = p.id;
  switchEditing(p.id);
  flash($('saveStatus'), '已新建并设为当前生效，记得点「保存」。', true);
});
$('profileRename').addEventListener('click', () => {
  const cur = profiles.find((p) => p.id === editingId);
  if (!cur) return;
  const name = prompt('画像名称', cur.name);
  if (!name) return;
  cur.name = name.trim();
  renderProfileSelect();
});
$('profileDelete').addEventListener('click', () => {
  if (profiles.length <= 1) { flash($('saveStatus'), '至少保留一套画像。', false); return; }
  const cur = profiles.find((p) => p.id === editingId);
  if (!cur || !confirm(`删除画像「${cur.name}」？（该画像下的判读缓存不会自动清除）`)) return;
  profiles = profiles.filter((p) => p.id !== cur.id);
  if (activeProfileId === cur.id) activeProfileId = profiles[0].id;
  editingId = null;
  switchEditing(profiles[0].id);
});
$('resetTweetProfile').addEventListener('click', () => fillTweetProfile(DEFAULT_TWEET_PROFILE));

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
