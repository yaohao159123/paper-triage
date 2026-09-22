const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));

async function load() {
  const s = await send({ type: 'getSettings' });
  $('enabled').checked = s.enabled !== false;
  const st = await send({ type: 'stats' });
  $('stats').innerHTML = st.ok
    ? `已缓存 ${st.total} 篇 · <span class="pill follow">关注</span>${st.follow} <span class="pill normal">普通</span>${st.normal} <span class="pill skip">跳过</span>${st.skip}`
    : '无法读取缓存';
  if (!s.apiKey) $('status').textContent = '尚未设置 API Key，请先打开设置。';
}

$('enabled').addEventListener('change', async (e) => {
  await send({ type: 'setSettings', patch: { enabled: e.target.checked } });
  $('status').textContent = e.target.checked ? '已启用' : '已停用（徽章隐藏、灰化取消）';
});

$('rerun').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  $('status').textContent = '重新判读中…';
  chrome.tabs.sendMessage(tab.id, { type: 'rerun' }, (r) => {
    $('status').textContent = chrome.runtime.lastError ? '当前页不是支持的文献列表页（Scholar / arXiv / PubMed）' : r?.ok ? '已重新判读' : '重判失败';
    load();
  });
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
