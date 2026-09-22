const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));

async function load() {
  const s = await send({ type: 'getSettings' });
  $('enabled').checked = s.enabled !== false;
  const sel = $('profile');
  sel.innerHTML = '';
  for (const p of s.profiles || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = s.activeProfileId;
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

$('profile').addEventListener('change', async (e) => {
  await send({ type: 'setSettings', patch: { activeProfileId: e.target.value } });
  $('status').textContent = '已切换画像，打开的文献页会自动按新画像重判。';
  load();
});

$('export').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'export', labels: ['follow'] }, async (r) => {
    if (chrome.runtime.lastError || !r?.ok) { $('status').textContent = '当前页不是支持的列表页'; return; }
    if (!r.count) { $('status').textContent = '本页没有「关注」条目'; return; }
    try {
      await navigator.clipboard.writeText(r.markdown);
      $('status').textContent = `已复制 ${r.count} 条到剪贴板`;
    } catch (err) {
      $('status').textContent = `复制失败：${err.message}`;
    }
  });
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
