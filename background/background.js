// Background service worker for YouTube Playlist Analyzer

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_PLAYLIST') {
    handlePlaylistAnalysis(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_PLAYLIST_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_PLAYLIST_DATA' }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
    });
    return true;
  }

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

async function handlePlaylistAnalysis(data) {
  const { videos } = data;
  if (!videos || videos.length === 0) {
    throw new Error('No videos found in the playlist');
  }

  const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
  const speeds = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const speedAnalysis = speeds.map(speed => ({
    speed,
    totalSeconds: Math.round(totalSeconds / speed),
    formatted: formatDuration(Math.round(totalSeconds / speed))
  }));

  // Calculate average video length
  const avgSeconds = Math.round(totalSeconds / videos.length);

  // Find shortest and longest videos
  const sorted = [...videos].sort((a, b) => a.durationSeconds - b.durationSeconds);
  const shortest = sorted[0];
  const longest = sorted[sorted.length - 1];

  // Calculate daily schedule options
  const dailySchedules = [
    { hoursPerDay: 0.5, label: '30 min/day' },
    { hoursPerDay: 1, label: '1 hr/day' },
    { hoursPerDay: 2, label: '2 hrs/day' },
    { hoursPerDay: 3, label: '3 hrs/day' },
    { hoursPerDay: 5, label: '5 hrs/day' }
  ].map(schedule => ({
    ...schedule,
    days: Math.ceil(totalSeconds / (schedule.hoursPerDay * 3600)),
    daysAt1_5x: Math.ceil((totalSeconds / 1.5) / (schedule.hoursPerDay * 3600)),
    daysAt2x: Math.ceil((totalSeconds / 2) / (schedule.hoursPerDay * 3600))
  }));

  // Calculate remaining stats from current video index
  const currentVideoIndex = Math.max(1, Math.min(parseInt(data.currentVideoIndex, 10) || 1, videos.length));
  const remainingVideos = videos.slice(currentVideoIndex - 1);
  const remainingSeconds = remainingVideos.reduce((sum, v) => sum + v.durationSeconds, 0);
  const remainingSpeeds = speeds.map(speed => ({
    speed,
    totalSeconds: Math.round(remainingSeconds / speed),
    formatted: formatDuration(Math.round(remainingSeconds / speed))
  }));

  const remainingDailySchedules = [
    { hoursPerDay: 0.5, label: '30 min/day' },
    { hoursPerDay: 1, label: '1 hr/day' },
    { hoursPerDay: 2, label: '2 hrs/day' },
    { hoursPerDay: 3, label: '3 hrs/day' },
    { hoursPerDay: 5, label: '5 hrs/day' }
  ].map(schedule => ({
    ...schedule,
    days: Math.ceil(remainingSeconds / (schedule.hoursPerDay * 3600)),
    daysAt1_5x: Math.ceil((remainingSeconds / 1.5) / (schedule.hoursPerDay * 3600)),
    daysAt2x: Math.ceil((remainingSeconds / 2) / (schedule.hoursPerDay * 3600))
  }));

  return {
    totalVideos: videos.length,
    totalDuration: formatDuration(totalSeconds),
    totalSeconds,
    averageDuration: formatDuration(avgSeconds),
    averageSeconds: avgSeconds,
    shortest: shortest ? { title: shortest.title, duration: formatDuration(shortest.durationSeconds), seconds: shortest.durationSeconds } : null,
    longest: longest ? { title: longest.title, duration: formatDuration(longest.durationSeconds), seconds: longest.durationSeconds } : null,
    speedAnalysis,
    dailySchedules,
    currentVideoIndex,
    remainingStats: {
      fromIndex: currentVideoIndex,
      remainingCount: remainingVideos.length,
      remainingSeconds,
      remainingDuration: formatDuration(remainingSeconds),
      speedAnalysis: remainingSpeeds,
      dailySchedules: remainingDailySchedules,
      at1_25x: formatDuration(Math.round(remainingSeconds / 1.25)),
      at1_5x: formatDuration(Math.round(remainingSeconds / 1.5)),
      at2x: formatDuration(Math.round(remainingSeconds / 2))
    },
    analyzedAt: new Date().toISOString()
  };
}

function formatDuration(totalSeconds) {
  if (typeof totalSeconds !== 'number' || isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  totalSeconds = Math.round(totalSeconds * 100) / 100;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round((totalSeconds % 60) * 100) / 100;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

async function saveToHistory(data) {
  const result = await chrome.storage.local.get('playlistHistory');
  const history = result.playlistHistory || [];

  // Check if this playlist already exists in history
  const existingIndex = history.findIndex(h => h.playlistUrl === data.playlistUrl);
  if (existingIndex !== -1) {
    history[existingIndex] = { ...data, analyzedAt: new Date().toISOString() };
  } else {
    history.unshift({ ...data, analyzedAt: new Date().toISOString() });
  }

  // Keep only last 50 entries
  if (history.length > 50) history.length = 50;

  await chrome.storage.local.set({ playlistHistory: history });
}

async function getHistory() {
  const result = await chrome.storage.local.get('playlistHistory');
  return result.playlistHistory || [];
}

async function clearHistory() {
  await chrome.storage.local.remove('playlistHistory');
}
