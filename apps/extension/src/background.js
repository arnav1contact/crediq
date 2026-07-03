chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['apiUrl', 'wallet', 'autoAnalyze']);
  const defaults = {};

  if (!existing.apiUrl) defaults.apiUrl = 'http://localhost:8787';
  if (!existing.wallet) defaults.wallet = [];
  if (typeof existing.autoAnalyze !== 'boolean') defaults.autoAnalyze = true;

  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }
});
