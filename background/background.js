// Background service worker for YouTube Playlist Analyzer
// Only manages analysis history; all calculations happen in lib/core.js
// (shared by the popup and the in-page panel).

const MAX_HISTORY = 50;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_HISTORY') {
    saveToHistory(message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_HISTORY') {
    getHistory()
      .then(history => sendResponse({ success: true, data: history }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    clearHistory()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function saveToHistory(data) {
  if (!data || typeof data.playlistUrl !== 'string' || !data.playlistUrl.startsWith('https://www.youtube.com/')) {
    throw new Error('Invalid history entry');
  }

  const result = await chrome.storage.local.get('playlistHistory');
  const history = result.playlistHistory || [];

  const entry = {
    playlistTitle: String(data.playlistTitle || 'Playlist'),
    playlistUrl: data.playlistUrl,
    totalVideos: Number(data.totalVideos) || 0,
    totalDuration: String(data.totalDuration || ''),
    totalSeconds: Number(data.totalSeconds) || 0,
    analyzedAt: new Date().toISOString()
  };

  // Most recent first, one entry per playlist
  const filtered = history.filter(h => h.playlistUrl !== entry.playlistUrl);
  filtered.unshift(entry);
  if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY;

  await chrome.storage.local.set({ playlistHistory: filtered });
}

async function getHistory() {
  const result = await chrome.storage.local.get('playlistHistory');
  return result.playlistHistory || [];
}

async function clearHistory() {
  await chrome.storage.local.remove('playlistHistory');
}
