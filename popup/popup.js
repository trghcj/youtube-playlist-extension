// YouTube Playlist Analyzer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('statusText');
  const notPlaylistEl = document.getElementById('notPlaylist');
  const errorStateEl = document.getElementById('errorState');
  const errorTextEl = document.getElementById('errorText');
  const mainContentEl = document.getElementById('mainContent');
  const retryBtn = document.getElementById('retryBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const historyBtn = document.getElementById('historyBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const historyPanel = document.getElementById('historyPanel');
  const settingsPanel = document.getElementById('settingsPanel');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  let currentAnalysis = null;
  let currentPlaylistData = null;

  // Tab navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Panel navigation
  historyBtn.addEventListener('click', () => {
    historyPanel.classList.toggle('hidden');
    settingsPanel.classList.add('hidden');
    if (!historyPanel.classList.contains('hidden')) loadHistory();
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    historyPanel.classList.add('hidden');
  });

  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  // Retry button
  retryBtn.addEventListener('click', () => startAnalysis());
  analyzeBtn.addEventListener('click', () => startAnalysis());

  // Clear history
  clearHistoryBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    loadHistory();
  });

  // Custom schedule calculator
  const customHours = document.getElementById('customHours');
  const customSpeed = document.getElementById('customSpeed');
  customHours.addEventListener('input', updateCustomSchedule);
  customSpeed.addEventListener('change', updateCustomSchedule);

  // Video search
  document.getElementById('videoSearch').addEventListener('input', (e) => {
    filterVideos(e.target.value);
  });

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortVideos(btn.dataset.sort);
    });
  });

  // Settings persistence
  loadSettings();
  document.getElementById('defaultSpeed').addEventListener('change', saveSettings);
  document.getElementById('autoAnalyze').addEventListener('change', saveSettings);
  document.getElementById('showFloatingBtn').addEventListener('change', saveSettings);
  document.getElementById('saveHistory').addEventListener('change', saveSettings);

  // Start analysis automatically
  startAnalysis();

  async function startAnalysis() {
    showView('status');
    statusTextEl.textContent = 'Checking page...';

    try {
      // Check if current tab is a YouTube playlist
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
        showView('notPlaylist');
        return;
      }

      if (!tab.url.includes('list=') && !tab.url.includes('/playlist')) {
        showView('notPlaylist');
        return;
      }

      statusTextEl.textContent = 'Extracting playlist data...';

      // Request data from content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PLAYLIST_DATA' });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to extract playlist data');
      }

      currentPlaylistData = response.data;
      statusTextEl.textContent = `Analyzing ${currentPlaylistData.videos.length} videos...`;

      // Send to background for analysis
      const analysisResponse = await chrome.runtime.sendMessage({
        type: 'ANALYZE_PLAYLIST',
        data: { videos: currentPlaylistData.videos }
      });

      if (!analysisResponse || !analysisResponse.success) {
        throw new Error(analysisResponse?.error || 'Analysis failed');
      }

      currentAnalysis = analysisResponse.data;

      // Save to history
      const saveHistoryEnabled = document.getElementById('saveHistory').checked;
      if (saveHistoryEnabled) {
        chrome.runtime.sendMessage({
          type: 'SAVE_HISTORY',
          data: {
            playlistTitle: currentPlaylistData.playlistTitle,
            playlistUrl: currentPlaylistData.playlistUrl,
            totalVideos: currentAnalysis.totalVideos,
            totalDuration: currentAnalysis.totalDuration,
            totalSeconds: currentAnalysis.totalSeconds
          }
        });
      }

      // Render results
      renderResults();
      showView('main');

    } catch (error) {
      console.error('Analysis error:', error);
      errorTextEl.textContent = error.message || 'Something went wrong. Make sure you\'re on a YouTube playlist page.';
      showView('error');
    }
  }

  function showView(view) {
    statusEl.classList.add('hidden');
    notPlaylistEl.classList.add('hidden');
    errorStateEl.classList.add('hidden');
    mainContentEl.classList.add('hidden');

    switch (view) {
      case 'status': statusEl.classList.remove('hidden'); break;
      case 'notPlaylist': notPlaylistEl.classList.remove('hidden'); break;
      case 'error': errorStateEl.classList.remove('hidden'); break;
      case 'main': mainContentEl.classList.remove('hidden'); break;
    }
  }

  function renderResults() {
    if (!currentAnalysis || !currentPlaylistData) return;

    // Playlist info
    document.getElementById('playlistTitle').textContent = currentPlaylistData.playlistTitle;
    document.getElementById('playlistChannel').textContent = currentPlaylistData.channelName || '';

    // Overview stats
    document.getElementById('totalDuration').textContent = currentAnalysis.totalDuration;
    document.getElementById('totalVideos').textContent = currentAnalysis.totalVideos;
    document.getElementById('avgDuration').textContent = currentAnalysis.averageDuration;

    const at2x = currentAnalysis.speedAnalysis.find(s => s.speed === 2);
    document.getElementById('at2xDuration').textContent = at2x ? at2x.formatted : '--';

    // Quick stats
    document.getElementById('shortestVideo').textContent = currentAnalysis.shortest
      ? `${currentAnalysis.shortest.duration} - ${truncate(currentAnalysis.shortest.title, 30)}`
      : '--';
    document.getElementById('longestVideo').textContent = currentAnalysis.longest
      ? `${currentAnalysis.longest.duration} - ${truncate(currentAnalysis.longest.title, 30)}`
      : '--';

    const unavailable = currentPlaylistData.videos.filter(v => v.isUnavailable).length;
    document.getElementById('unavailableCount').textContent = unavailable > 0 ? `${unavailable} videos` : 'None';

    // Speeds tab
    renderSpeeds();

    // Schedule tab
    renderSchedule();

    // Videos tab
    renderVideoList();

    // Update custom schedule
    updateCustomSchedule();
  }

  function renderSpeeds() {
    const container = document.getElementById('speedsList');
    const timeSavedContainer = document.getElementById('timeSaved');
    const totalSeconds = currentAnalysis.totalSeconds;

    container.innerHTML = currentAnalysis.speedAnalysis.map(item => {
      const percentage = (item.totalSeconds / totalSeconds) * 100;
      const isRecommended = item.speed === 1.5;
      return `
        <div class="speed-item ${isRecommended ? 'recommended' : ''}">
          <span class="speed-badge">${item.speed}x</span>
          <div class="speed-bar-container">
            <div class="speed-bar" style="width: ${percentage}%"></div>
          </div>
          <span class="speed-duration">${item.formatted}</span>
        </div>
      `;
    }).join('');

    // Time saved calculations
    const speedsToShow = [1.25, 1.5, 2, 3];
    timeSavedContainer.innerHTML = speedsToShow.map(speed => {
      const saved = totalSeconds - Math.round(totalSeconds / speed);
      return `
        <div class="time-saved-item">
          <div class="time-saved-speed">At ${speed}x</div>
          <div class="time-saved-value">${formatDuration(saved)}</div>
        </div>
      `;
    }).join('');
  }

  function renderSchedule() {
    const container = document.getElementById('scheduleList');

    container.innerHTML = `
      <div class="schedule-item header">
        <span>Watch Time</span>
        <span>1x</span>
        <span>1.5x</span>
        <span>2x</span>
      </div>
      ${currentAnalysis.dailySchedules.map(schedule => `
        <div class="schedule-item">
          <span class="schedule-label">${schedule.label}</span>
          <span class="schedule-value">${schedule.days} day${schedule.days !== 1 ? 's' : ''}</span>
          <span class="schedule-value highlight">${schedule.daysAt1_5x} day${schedule.daysAt1_5x !== 1 ? 's' : ''}</span>
          <span class="schedule-value">${schedule.daysAt2x} day${schedule.daysAt2x !== 1 ? 's' : ''}</span>
        </div>
      `).join('')}
    `;
  }

  function renderVideoList(videos = null) {
    const container = document.getElementById('videosList');
    const videoData = videos || currentPlaylistData.videos;

    container.innerHTML = videoData.map(video => `
      <div class="video-item ${video.isUnavailable ? 'unavailable' : ''}" 
           data-url="${video.url}" 
           data-index="${video.index}"
           data-duration="${video.durationSeconds}"
           title="${escapeHtml(video.title)}">
        <span class="video-index">${video.index}</span>
        <span class="video-title">${escapeHtml(video.title)}</span>
        <span class="video-duration">${video.durationFormatted}</span>
      </div>
    `).join('');

    // Click to open video
    container.querySelectorAll('.video-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url) {
          chrome.tabs.create({ url });
        }
      });
    });
  }

  function filterVideos(query) {
    if (!currentPlaylistData) return;
    const filtered = query
      ? currentPlaylistData.videos.filter(v =>
          v.title.toLowerCase().includes(query.toLowerCase()))
      : currentPlaylistData.videos;
    renderVideoList(filtered);
  }

  function sortVideos(sortType) {
    if (!currentPlaylistData) return;
    let sorted = [...currentPlaylistData.videos];

    switch (sortType) {
      case 'duration-asc':
        sorted.sort((a, b) => a.durationSeconds - b.durationSeconds);
        break;
      case 'duration-desc':
        sorted.sort((a, b) => b.durationSeconds - a.durationSeconds);
        break;
      case 'index':
      default:
        sorted.sort((a, b) => a.index - b.index);
        break;
    }

    renderVideoList(sorted);
  }

  function updateCustomSchedule() {
    if (!currentAnalysis) return;

    const hours = parseFloat(customHours.value) || 1;
    const speed = parseFloat(customSpeed.value) || 1;
    const adjustedSeconds = currentAnalysis.totalSeconds / speed;
    const days = Math.ceil(adjustedSeconds / (hours * 3600));

    document.getElementById('customDays').textContent = days;
  }

  async function loadHistory() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    const historyList = document.getElementById('historyList');

    if (!response.success || !response.data || response.data.length === 0) {
      historyList.innerHTML = '<p class="empty-text">No playlists analyzed yet</p>';
      return;
    }

    historyList.innerHTML = response.data.map(item => `
      <div class="history-item" data-url="${item.playlistUrl}">
        <div class="history-title">${escapeHtml(item.playlistTitle)}</div>
        <div class="history-meta">
          <span>${item.totalVideos} videos</span>
          <span>${item.totalDuration}</span>
          <span>${new Date(item.analyzedAt).toLocaleDateString()}</span>
        </div>
      </div>
    `).join('');

    historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: item.dataset.url });
      });
    });
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings || {};

    if (settings.defaultSpeed) document.getElementById('defaultSpeed').value = settings.defaultSpeed;
    if (settings.autoAnalyze !== undefined) document.getElementById('autoAnalyze').checked = settings.autoAnalyze;
    if (settings.showFloatingBtn !== undefined) document.getElementById('showFloatingBtn').checked = settings.showFloatingBtn;
    if (settings.saveHistory !== undefined) document.getElementById('saveHistory').checked = settings.saveHistory;
  }

  async function saveSettings() {
    const settings = {
      defaultSpeed: document.getElementById('defaultSpeed').value,
      autoAnalyze: document.getElementById('autoAnalyze').checked,
      showFloatingBtn: document.getElementById('showFloatingBtn').checked,
      saveHistory: document.getElementById('saveHistory').checked
    };
    await chrome.storage.local.set({ settings });
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

  function truncate(str, length) {
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
