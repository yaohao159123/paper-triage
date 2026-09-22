// Classic content script that boots the ES-module entry point.
(async () => {
  try {
    await import(chrome.runtime.getURL('src/content/main.js'));
  } catch (err) {
    console.warn('[paper-triage] failed to start', err);
  }
})();
