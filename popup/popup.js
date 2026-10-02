// YouTube Playlist Analyzer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusEl = document.getElementById('status');
  const statusTextEl = document.getElementById('statusText');
  const notPlaylistEl = document.getElementById('notPlaylist');
  const errorStateEl = document.getElementById('errorState');
  const errorTitleEl = document.getElementById('errorTitle');
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
      const targetContent = document.getElementById(`tab-${tab.dataset.tab}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // Panel navigation
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      if (historyPanel) historyPanel.classList.toggle('hidden');
      if (settingsPanel) settingsPanel.classList.add('hidden');
      if (historyPanel && !historyPanel.classList.contains('hidden')) loadHistory();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (settingsPanel) settingsPanel.classList.toggle('hidden');
      if (historyPanel) historyPanel.classList.add('hidden');
    });
  }

  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.close);
      if (target) target.classList.add('hidden');
    });
  });

  // Retry & Re-analyze buttons
  if (retryBtn) retryBtn.addEventListener('click', () => startAnalysis());
  if (analyzeBtn) analyzeBtn.addEventListener('click', () => startAnalysis());

  // Clear history
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      loadHistory();
    });
  }

  // Remaining watch time input
  const fromVideoInput = document.getElementById('fromVideoIndex');
  if (fromVideoInput) {
    fromVideoInput.addEventListener('input', () => {
      updateRemainingStats(fromVideoInput.value);
    });
  }

  // Custom schedule calculator & scope selector
  const customHours = document.getElementById('customHours');
  const customSpeed = document.getElementById('customSpeed');
  const scheduleScope = document.getElementById('scheduleScope');
  if (customHours) customHours.addEventListener('input', updateCustomSchedule);
  if (customSpeed) customSpeed.addEventListener('change', updateCustomSchedule);
  if (scheduleScope) scheduleScope.addEventListener('change', updateCustomSchedule);

  // Video search
  const videoSearchEl = document.getElementById('videoSearch');
  if (videoSearchEl) {
    videoSearchEl.addEventListener('input', (e) => {
      filterVideos(e.target.value);
    });
  }

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
  const defSpeedEl = document.getElementById('defaultSpeed');
  if (defSpeedEl) defSpeedEl.addEventListener('change', saveSettings);
  const autoAnEl = document.getElementById('autoAnalyze');
  if (autoAnEl) autoAnEl.addEventListener('change', saveSettings);
  const showBtnEl = document.getElementById('showFloatingBtn');
  if (showBtnEl) showBtnEl.addEventListener('change', saveSettings);
  const saveHistEl = document.getElementById('saveHistory');
  if (saveHistEl) saveHistEl.addEventListener('change', saveSettings);

  // Start analysis automatically
  startAnalysis();

  async function startAnalysis() {
    // Reset retry button to default behavior
    if (retryBtn) {
      retryBtn.textContent = 'Try Again';
      retryBtn.onclick = () => startAnalysis();
    }
    if (errorTitleEl) errorTitleEl.textContent = 'Oops!';

    showView('status');
    if (statusTextEl) statusTextEl.textContent = 'Checking page...';

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

      if (statusTextEl) statusTextEl.textContent = 'Extracting playlist data...';

      // Request data from content script with graceful connection handling
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PLAYLIST_DATA' });
      } catch (connErr) {
        // Tab was open before extension was installed or reloaded
        console.warn('Content script not yet connected to tab:', connErr?.message);
        if (errorTitleEl) errorTitleEl.textContent = 'Refresh Required';
        if (errorTextEl) errorTextEl.textContent = 'Please refresh this YouTube page (F5) once so the extension can connect.';
        if (retryBtn) {
          retryBtn.textContent = 'Refresh YouTube Page';
          retryBtn.onclick = async () => {
            if (tab && tab.id) {
              await chrome.tabs.reload(tab.id);
            }
            window.close();
          };
        }
        showView('error');
        return;
      }

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to extract playlist data');
      }

      currentPlaylistData = response.data;
      const count = currentPlaylistData && currentPlaylistData.videos ? currentPlaylistData.videos.length : 0;
      if (statusTextEl) statusTextEl.textContent = `Analyzing ${count} videos...`;

      // Send to background for analysis with currentVideoIndex
      const analysisResponse = await chrome.runtime.sendMessage({
        type: 'ANALYZE_PLAYLIST',
        data: {
          videos: currentPlaylistData.videos,
          currentVideoIndex: currentPlaylistData.currentVideoIndex || 1
        }
      });

      if (!analysisResponse || !analysisResponse.success) {
        throw new Error(analysisResponse?.error || 'Analysis failed');
      }

      currentAnalysis = analysisResponse.data;

      // Save to history
      const saveHistoryEl = document.getElementById('saveHistory');
      const saveHistoryEnabled = saveHistoryEl ? saveHistoryEl.checked : true;
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
      console.warn('Analysis error handled:', error);
      if (errorTextEl) {
        errorTextEl.textContent = error.message || 'Something went wrong. Make sure you\'re on a YouTube playlist page.';
      }
      showView('error');
    }
  }

  function showView(view) {
    if (statusEl) statusEl.classList.add('hidden');
    if (notPlaylistEl) notPlaylistEl.classList.add('hidden');
    if (errorStateEl) errorStateEl.classList.add('hidden');
    if (mainContentEl) mainContentEl.classList.add('hidden');

    switch (view) {
      case 'status': if (statusEl) statusEl.classList.remove('hidden'); break;
      case 'notPlaylist': if (notPlaylistEl) notPlaylistEl.classList.remove('hidden'); break;
      case 'error': if (errorStateEl) errorStateEl.classList.remove('hidden'); break;
      case 'main': if (mainContentEl) mainContentEl.classList.remove('hidden'); break;
    }
  }

  function renderResults() {
    if (!currentAnalysis || !currentPlaylistData) return;

    // Playlist info
    const titleEl = document.getElementById('playlistTitle');
    if (titleEl) titleEl.textContent = currentPlaylistData.playlistTitle || 'YouTube Playlist';

    const channelEl = document.getElementById('playlistChannel');
    if (channelEl) channelEl.textContent = currentPlaylistData.channelName || '';

    // Initialize remaining watch time card
    const initialFromIndex = currentPlaylistData.currentVideoIndex || 1;
    const fromVidInput = document.getElementById('fromVideoIndex');
    const totalCountLbl = document.getElementById('totalVideosCountLabel');
    if (fromVidInput) {
      fromVidInput.max = currentPlaylistData.videos.length;
      fromVidInput.value = initialFromIndex;
    }
    if (totalCountLbl) {
      totalCountLbl.textContent = `of ${currentPlaylistData.videos.length}`;
    }
    updateRemainingStats(initialFromIndex);

    // Overview stats
    const totalDurationEl = document.getElementById('totalDuration');
    if (totalDurationEl) totalDurationEl.textContent = currentAnalysis.totalDuration || '--';

    const totalVideosEl = document.getElementById('totalVideos');
    if (totalVideosEl) totalVideosEl.textContent = currentAnalysis.totalVideos ?? '--';

    const avgDurationEl = document.getElementById('avgDuration');
    if (avgDurationEl) avgDurationEl.textContent = currentAnalysis.averageDuration || '--';

    const at2x = (currentAnalysis.speedAnalysis || []).find(s => s.speed === 2);
    const at2xDurationEl = document.getElementById('at2xDuration');
    if (at2xDurationEl) at2xDurationEl.textContent = at2x ? at2x.formatted : '--';

    // Quick stats
    const shortestVideoEl = document.getElementById('shortestVideo');
    if (shortestVideoEl) {
      shortestVideoEl.textContent = currentAnalysis.shortest
        ? `${currentAnalysis.shortest.duration} - ${truncate(currentAnalysis.shortest.title, 30)}`
        : '--';
    }

    const longestVideoEl = document.getElementById('longestVideo');
    if (longestVideoEl) {
      longestVideoEl.textContent = currentAnalysis.longest
        ? `${currentAnalysis.longest.duration} - ${truncate(currentAnalysis.longest.title, 30)}`
        : '--';
    }

    const unavailable = ((currentPlaylistData.videos) || []).filter(v => v.isUnavailable).length;
    const unavailableCountEl = document.getElementById('unavailableCount');
    if (unavailableCountEl) unavailableCountEl.textContent = unavailable > 0 ? `${unavailable} videos` : 'None';

    // Speeds tab
    renderSpeeds();

    // Schedule tab
    renderSchedule();

    // Videos tab
    renderVideoList();

    // Update custom schedule
    updateCustomSchedule();
  }

  function updateRemainingStats(fromIndex) {
    if (!currentPlaylistData || !currentPlaylistData.videos || currentPlaylistData.videos.length === 0) return;
    const total = currentPlaylistData.videos.length;
    fromIndex = Math.max(1, Math.min(parseInt(fromIndex, 10) || 1, total));

    const fromVidInput = document.getElementById('fromVideoIndex');
    if (fromVidInput && parseInt(fromVidInput.value, 10) !== fromIndex) {
      fromVidInput.value = fromIndex;
    }

    const remainingVideos = currentPlaylistData.videos.slice(fromIndex - 1);
    const remainingSeconds = remainingVideos.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);

    const badgeEl = document.getElementById('currentVideoBadge');
    if (badgeEl) {
      badgeEl.textContent = fromIndex > 1 ? `Now at Video ${fromIndex}` : `Full Playlist (${total} vids)`;
    }

    const durEl = document.getElementById('remainingDuration');
    if (durEl) durEl.textContent = formatDuration(remainingSeconds);

    const countEl = document.getElementById('remainingCount');
    if (countEl) countEl.textContent = `${remainingVideos.length} videos left`;

    const at15xEl = document.getElementById('remainingAt1_5x');
    if (at15xEl) at15xEl.textContent = formatDuration(Math.round(remainingSeconds / 1.5));

    const at2xEl = document.getElementById('remainingAt2x');
    if (at2xEl) at2xEl.textContent = formatDuration(Math.round(remainingSeconds / 2));

    updateCustomSchedule();
    highlightCurrentVideo(fromIndex);
  }

  function highlightCurrentVideo(fromIdx) {
    const container = document.getElementById('videosList');
    if (!container) return;
    container.querySelectorAll('.video-item').forEach(item => {
      const idx = parseInt(item.dataset.index, 10);
      item.classList.toggle('current-video', idx === fromIdx);
      item.classList.toggle('watched-video', idx < fromIdx);
    });
  }

  function renderSpeeds() {
    const container = document.getElementById('speedsList');
    const timeSavedContainer = document.getElementById('timeSaved');
    if (!container || !currentAnalysis || !currentAnalysis.speedAnalysis) return;

    const totalSeconds = currentAnalysis.totalSeconds || 0;

    container.innerHTML = currentAnalysis.speedAnalysis.map(item => {
      const percentage = totalSeconds > 0 ? (item.totalSeconds / totalSeconds) * 100 : 0;
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
    if (timeSavedContainer) {
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
  }

  function renderSchedule() {
    const container = document.getElementById('scheduleList');
    if (!container || !currentAnalysis || !currentAnalysis.dailySchedules) return;

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
    if (!container || !currentPlaylistData || !currentPlaylistData.videos) return;

    const fromVidInput = document.getElementById('fromVideoIndex');
    const currentFromIndex = fromVidInput ? (parseInt(fromVidInput.value, 10) || 1) : 1;

    const videoData = videos || currentPlaylistData.videos;

    container.innerHTML = videoData.map(video => {
      const idx = video.index || 0;
      const isCurrent = idx === currentFromIndex;
      const isWatched = idx < currentFromIndex;
      return `
        <div class="video-item ${video.isUnavailable ? 'unavailable' : ''} ${isCurrent ? 'current-video' : ''} ${isWatched ? 'watched-video' : ''}" 
             data-url="${video.url || ''}" 
             data-index="${video.index || ''}"
             data-duration="${video.durationSeconds || 0}"
             title="${escapeHtml(video.title || '')}">
          <span class="video-index">${video.index || ''}</span>
          <span class="video-title">${escapeHtml(video.title || 'Untitled')}</span>
          <span class="video-duration">${video.durationFormatted || '--'}</span>
        </div>
      `;
    }).join('');

    // Click to open video or select as starting point
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
    if (!currentPlaylistData || !currentPlaylistData.videos) return;
    const filtered = query
      ? currentPlaylistData.videos.filter(v =>
          (v.title || '').toLowerCase().includes(query.toLowerCase()))
      : currentPlaylistData.videos;
    renderVideoList(filtered);
  }

  function sortVideos(sortType) {
    if (!currentPlaylistData || !currentPlaylistData.videos) return;
    let sorted = [...currentPlaylistData.videos];

    switch (sortType) {
      case 'duration-asc':
        sorted.sort((a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0));
        break;
      case 'duration-desc':
        sorted.sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0));
        break;
      case 'index':
      default:
        sorted.sort((a, b) => (a.index || 0) - (b.index || 0));
        break;
    }

    renderVideoList(sorted);
  }

  function updateCustomSchedule() {
    if (!currentAnalysis || !currentPlaylistData) return;

    const hours = (customHours && parseFloat(customHours.value)) || 1;
    const speed = (customSpeed && parseFloat(customSpeed.value)) || 1;
    const scopeEl = document.getElementById('scheduleScope');
    const scope = scopeEl ? scopeEl.value : 'remaining';

    let targetSeconds = currentAnalysis.totalSeconds || 0;
    if (scope === 'remaining') {
      const fromVidInput = document.getElementById('fromVideoIndex');
      const fromIdx = Math.max(1, Math.min(parseInt(fromVidInput?.value, 10) || 1, currentPlaylistData.videos.length));
      const remVideos = currentPlaylistData.videos.slice(fromIdx - 1);
      targetSeconds = remVideos.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    }

    const adjustedSeconds = targetSeconds / speed;
    const days = Math.ceil(adjustedSeconds / (hours * 3600));

    const customDaysEl = document.getElementById('customDays');
    if (customDaysEl) {
      customDaysEl.textContent = isFinite(days) ? days : '--';
    }
  }

  async function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });

      if (!response || !response.success || !response.data || response.data.length === 0) {
        historyList.innerHTML = '<p class="empty-text">No playlists analyzed yet</p>';
        return;
      }

      historyList.innerHTML = response.data.map(item => `
        <div class="history-item" data-url="${item.playlistUrl}">
          <div class="history-title">${escapeHtml(item.playlistTitle || 'Playlist')}</div>
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
    } catch (e) {
      console.warn('Failed to load history:', e);
      historyList.innerHTML = '<p class="empty-text">Failed to load history</p>';
    }
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      const settings = result.settings || {};

      const defSpeedEl = document.getElementById('defaultSpeed');
      if (defSpeedEl && settings.defaultSpeed) defSpeedEl.value = settings.defaultSpeed;
      const autoAnEl = document.getElementById('autoAnalyze');
      if (autoAnEl && settings.autoAnalyze !== undefined) autoAnEl.checked = settings.autoAnalyze;
      const showBtnEl = document.getElementById('showFloatingBtn');
      if (showBtnEl && settings.showFloatingBtn !== undefined) showBtnEl.checked = settings.showFloatingBtn;
      const saveHistEl = document.getElementById('saveHistory');
      if (saveHistEl && settings.saveHistory !== undefined) saveHistEl.checked = settings.saveHistory;
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  async function saveSettings() {
    try {
      const defSpeedEl = document.getElementById('defaultSpeed');
      const autoAnEl = document.getElementById('autoAnalyze');
      const showBtnEl = document.getElementById('showFloatingBtn');
      const saveHistEl = document.getElementById('saveHistory');

      const settings = {
        defaultSpeed: defSpeedEl ? defSpeedEl.value : '1.5',
        autoAnalyze: autoAnEl ? autoAnEl.checked : true,
        showFloatingBtn: showBtnEl ? showBtnEl.checked : true,
        saveHistory: saveHistEl ? saveHistEl.checked : true
      };
      await chrome.storage.local.set({ settings });
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
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
    if (!str) return '';
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
