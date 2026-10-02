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
  let videoPollTimer = null;

  function stopVideoAnalyzer() {
    if (videoPollTimer) {
      clearInterval(videoPollTimer);
      videoPollTimer = null;
    }
  }

  window.addEventListener('unload', stopVideoAnalyzer);

  // Tab navigation
  document.querySelectorAll('.yt-pa-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.yt-pa-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.yt-pa-tab-content').forEach(c => c.classList.remove('active'));
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

  document.querySelectorAll('.yt-pa-panel-close').forEach(btn => {
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

  // Remaining watch time dropdown
  const fromVideoSelect = document.getElementById('fromVideoSelect');
  if (fromVideoSelect) {
    fromVideoSelect.addEventListener('change', () => {
      updateRemainingStats(fromVideoSelect.value);
    });
  }

  // Custom schedule calculator & scope selector
  const customHours = document.getElementById('customHours');
  const customSpeed = document.getElementById('customSpeed');
  const scheduleScope = document.getElementById('scheduleScope');
  if (customHours) customHours.addEventListener('change', updateCustomSchedule);
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
  document.querySelectorAll('.yt-pa-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.yt-pa-sort-btn').forEach(b => b.classList.remove('active'));
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
    stopVideoAnalyzer();

    // Reset retry button to default behavior
    if (retryBtn) {
      retryBtn.textContent = 'Try Again';
      retryBtn.onclick = () => startAnalysis();
    }
    if (errorTitleEl) errorTitleEl.textContent = 'Oops!';

    showView('status');
    if (statusTextEl) statusTextEl.textContent = 'Checking page...';

    try {
      // Check if current tab is a YouTube page
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
        showView('notPlaylist');
        return;
      }

      const isWatch = tab.url.includes('/watch') || tab.url.includes('/shorts/');
      const hasPlaylist = tab.url.includes('list=') || tab.url.includes('/playlist');

      if (!isWatch && !hasPlaylist) {
        showView('notPlaylist');
        return;
      }

      if (isWatch && !hasPlaylist) {
        // Single video mode
        await startSingleVideoMode(tab.id);
        return;
      }

      // Playlist mode
      await startPlaylistMode(tab);

    } catch (error) {
      console.warn('Analysis error handled:', error);
      if (errorTextEl) {
        errorTextEl.textContent = error.message || 'Something went wrong. Make sure you\'re on a YouTube playlist or video page.';
      }
      showView('error');
    }
  }

  async function startSingleVideoMode(tabId) {
    const headerTitleEl = document.getElementById('headerTitle');
    const topNavEl = document.getElementById('topNav');
    const playlistTabsWrapper = document.getElementById('playlistTabsWrapper');
    const videoResultsEl = document.getElementById('videoResults');

    if (headerTitleEl) headerTitleEl.textContent = 'Video Analyzer';
    if (topNavEl) topNavEl.classList.add('hidden');
    if (playlistTabsWrapper) playlistTabsWrapper.style.display = 'none';
    if (videoResultsEl) videoResultsEl.style.display = 'flex';

    initVideoModeDOM(tabId);

    const ok = await updateSingleVideoUI(tabId);
    if (!ok) return;

    showView('main');

    // Poll every 1 second while popup is open to keep progress and clocks live
    videoPollTimer = setInterval(async () => {
      await updateSingleVideoUI(tabId);
    }, 1000);
  }

  function initVideoModeDOM(tabId) {
    const speedsTable = document.getElementById('vidSpeedsTable');
    const tsGrid = document.getElementById('vidTimeSavedGrid');
    const speeds = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];

    if (speedsTable && !speedsTable.hasChildNodes()) {
      speedsTable.innerHTML = speeds.map(sp => `
        <div class="yt-pa-vid-speed-row" data-speed="${sp}">
          <span class="yt-pa-vid-speed-label">${sp}×</span>
          <span class="yt-pa-vid-speed-time">--</span>
          <span class="yt-pa-vid-speed-finish">--</span>
          <button class="yt-pa-vid-set-speed-btn" data-speed="${sp}">Set ${sp}×</button>
        </div>
      `).join('');

      speedsTable.querySelectorAll('.yt-pa-vid-speed-row').forEach(row => {
        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetSpeed = parseFloat(row.dataset.speed);
          if (!isNaN(targetSpeed)) {
            try {
              await chrome.tabs.sendMessage(tabId, { type: 'SET_PLAYBACK_SPEED', speed: targetSpeed });
              await updateSingleVideoUI(tabId);
            } catch (err) {
              console.warn('Failed to set speed:', err);
            }
          }
        });
      });
    }

    if (tsGrid && !tsGrid.hasChildNodes()) {
      tsGrid.innerHTML = [1.25, 1.5, 2, 3].map(sp => `
        <div class="yt-pa-ts-row" data-speed="${sp}">
          <span class="yt-pa-ts-label">At ${sp}×</span>
          <span class="yt-pa-ts-val">--</span>
        </div>
      `).join('');
    }
  }

  async function updateSingleVideoUI(tabId) {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_DATA' });
    } catch (connErr) {
      console.warn('Content script not reachable:', connErr?.message);
      if (errorTitleEl) errorTitleEl.textContent = 'Refresh Required';
      if (errorTextEl) errorTextEl.textContent = 'Please refresh this YouTube page (F5) once so the extension can connect.';
      if (retryBtn) {
        retryBtn.textContent = 'Refresh YouTube Page';
        retryBtn.onclick = async () => {
          await chrome.tabs.reload(tabId);
          window.close();
        };
      }
      showView('error');
      stopVideoAnalyzer();
      return false;
    }

    if (!response || !response.success || !response.data) {
      if (errorTitleEl) errorTitleEl.textContent = 'No Video Found';
      if (errorTextEl) errorTextEl.textContent = response?.error || 'Make sure a video is playing on this page.';
      showView('error');
      stopVideoAnalyzer();
      return false;
    }

    const { title, channel, currentTime, duration, playbackRate } = response.data;
    if (isNaN(duration) || duration <= 0) return true;

    const vidTitle = document.getElementById('vidTitle');
    const vidChannel = document.getElementById('vidChannel');
    if (vidTitle && vidTitle.textContent !== title) vidTitle.textContent = title || 'YouTube Video';
    if (vidChannel && vidChannel.textContent !== channel) vidChannel.textContent = channel || '';

    const currentSpeed = playbackRate || 1;
    const remainingSeconds = Math.max(0, duration - currentTime);
    const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

    const fillEl = document.getElementById('vidProgressFill');
    if (fillEl) fillEl.style.width = `${progressPercent.toFixed(1)}%`;

    const currEl = document.getElementById('vidCurrentTime');
    const totEl = document.getElementById('vidTotalTime');
    if (currEl) currEl.textContent = formatTime(Math.round(currentTime));
    if (totEl) totEl.textContent = formatTime(Math.round(duration));

    const adjustedRemaining = remainingSeconds / currentSpeed;
    const endDate = new Date(Date.now() + adjustedRemaining * 1000);
    const endClockStr = endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const clockEl = document.getElementById('vidEndClock');
    const remainEl = document.getElementById('vidRemainText');
    if (clockEl) clockEl.textContent = endClockStr;
    if (remainEl) remainEl.textContent = `${formatDuration(Math.round(adjustedRemaining))} left (${currentSpeed}×)`;

    const speedsTable = document.getElementById('vidSpeedsTable');
    if (speedsTable) {
      speedsTable.querySelectorAll('.yt-pa-vid-speed-row').forEach(row => {
        const sp = parseFloat(row.dataset.speed);
        if (isNaN(sp)) return;
        const spRemaining = Math.max(0, remainingSeconds / sp);
        const spFinish = new Date(Date.now() + spRemaining * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const isCurrent = Math.abs(currentSpeed - sp) < 0.05;

        row.classList.toggle('active', isCurrent);

        const timeEl = row.querySelector('.yt-pa-vid-speed-time');
        if (timeEl) timeEl.textContent = `${formatDuration(Math.round(spRemaining))} left`;

        const finishEl = row.querySelector('.yt-pa-vid-speed-finish');
        if (finishEl) finishEl.textContent = `Ends at ${spFinish}`;

        const btnEl = row.querySelector('.yt-pa-vid-set-speed-btn');
        if (btnEl) {
          btnEl.classList.toggle('active', isCurrent);
          btnEl.textContent = isCurrent ? 'Active' : `Set ${sp}×`;
        }
      });
    }

    const tsGrid = document.getElementById('vidTimeSavedGrid');
    if (tsGrid) {
      const baseRemaining = remainingSeconds;
      tsGrid.querySelectorAll('.yt-pa-ts-row').forEach(item => {
        const sp = parseFloat(item.dataset.speed);
        if (isNaN(sp)) return;
        const saved = Math.max(0, baseRemaining - Math.round(baseRemaining / sp));
        const valEl = item.querySelector('.yt-pa-ts-val');
        if (valEl) valEl.textContent = formatDuration(saved);
      });
    }

    return true;
  }

  async function startPlaylistMode(tab) {
    const headerTitleEl = document.getElementById('headerTitle');
    const topNavEl = document.getElementById('topNav');
    const playlistTabsWrapper = document.getElementById('playlistTabsWrapper');
    const videoResultsEl = document.getElementById('videoResults');

    if (headerTitleEl) headerTitleEl.textContent = 'Playlist Analyzer';
    if (topNavEl) topNavEl.classList.remove('hidden');
    if (playlistTabsWrapper) playlistTabsWrapper.style.display = 'block';
    if (videoResultsEl) videoResultsEl.style.display = 'none';

    if (statusTextEl) statusTextEl.textContent = 'Extracting playlist data...';

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PLAYLIST_DATA' });
    } catch (connErr) {
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
  }

  function showView(view) {
    if (statusEl) statusEl.classList.add('hidden');
    if (notPlaylistEl) notPlaylistEl.classList.add('hidden');
    if (errorStateEl) errorStateEl.classList.add('hidden');
    if (mainContentEl) mainContentEl.classList.add('hidden');

    const topNavEl = document.getElementById('topNav');
    if (view !== 'main') {
      if (topNavEl) topNavEl.classList.add('hidden');
    }

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

    // Populate video dropdown
    const initialFromIndex = currentPlaylistData.currentVideoIndex || 1;
    const fromVidSelect = document.getElementById('fromVideoSelect');
    if (fromVidSelect && currentPlaylistData.videos) {
      fromVidSelect.innerHTML = currentPlaylistData.videos.map(v => {
        const cleanTitle = (v.title || '').replace(/\s+/g, ' ').trim();
        const shortTitle = cleanTitle.length > 24 ? cleanTitle.substring(0, 22) + '…' : cleanTitle;
        const dur = v.durationFormatted ? ` (${v.durationFormatted})` : '';
        return `<option value="${v.index}">Video ${v.index}: ${escapeHtml(shortTitle)}${dur}</option>`;
      }).join('');
      fromVidSelect.value = initialFromIndex;
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

    // Shortest / Longest
    const shortestEl = document.getElementById('shortestVideo');
    if (shortestEl) {
      if (currentAnalysis.shortest) {
        const s = currentAnalysis.shortest;
        const title = s.title.length > 36 ? s.title.substring(0, 34) + '...' : s.title;
        shortestEl.innerHTML = `
          <span class="yt-pa-ov-ext-title" title="${escapeHtml(s.title)}">${escapeHtml(title)}</span>
          <span class="yt-pa-ov-ext-time">${s.duration}</span>
        `;
      } else {
        shortestEl.textContent = '--';
      }
    }

    const longestEl = document.getElementById('longestVideo');
    if (longestEl) {
      if (currentAnalysis.longest) {
        const l = currentAnalysis.longest;
        const title = l.title.length > 36 ? l.title.substring(0, 34) + '...' : l.title;
        longestEl.innerHTML = `
          <span class="yt-pa-ov-ext-title" title="${escapeHtml(l.title)}">${escapeHtml(title)}</span>
          <span class="yt-pa-ov-ext-time">${l.duration}</span>
        `;
      } else {
        longestEl.textContent = '--';
      }
    }

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

    const fromVidSelect = document.getElementById('fromVideoSelect');
    if (fromVidSelect && parseInt(fromVidSelect.value, 10) !== fromIndex) {
      fromVidSelect.value = fromIndex;
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
    if (countEl) countEl.textContent = `${remainingVideos.length} vids left`;

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
        <div class="yt-pa-speed-row ${isRecommended ? 'active' : ''}">
          <span class="yt-pa-speed-label">${item.speed}×</span>
          <div class="yt-pa-speed-bar-bg">
            <div class="yt-pa-speed-bar-fill" style="width: ${percentage}%"></div>
          </div>
          <span class="yt-pa-speed-val">${item.formatted}</span>
        </div>
      `;
    }).join('');

    // Time saved calculations
    if (timeSavedContainer) {
      const speedsToShow = [1.25, 1.5, 2, 3];
      timeSavedContainer.innerHTML = speedsToShow.map(speed => {
        const saved = totalSeconds - Math.round(totalSeconds / speed);
        return `
          <div class="yt-pa-ts-row">
            <span class="yt-pa-ts-label">At ${speed}×</span>
            <span class="yt-pa-ts-val">${formatDuration(saved)}</span>
          </div>
        `;
      }).join('');
    }
  }

  function renderSchedule() {
    const container = document.getElementById('scheduleList');
    if (!container || !currentAnalysis || !currentAnalysis.dailySchedules) return;

    container.innerHTML = `
      <div class="yt-pa-sched-header">
        <span class="yt-pa-sched-col-time">Watch time / day</span>
        <span class="yt-pa-sched-col">1×</span>
        <span class="yt-pa-sched-col yt-pa-sched-col-active">1.5×</span>
        <span class="yt-pa-sched-col">2×</span>
      </div>
      <div class="yt-pa-sched-body">
        ${currentAnalysis.dailySchedules.map(schedule => `
          <div class="yt-pa-sched-row">
            <span class="yt-pa-sched-col-time">${schedule.label}</span>
            <span class="yt-pa-sched-col">${schedule.days}d</span>
            <span class="yt-pa-sched-col yt-pa-sched-col-active">${schedule.daysAt1_5x}d</span>
            <span class="yt-pa-sched-col">${schedule.daysAt2x}d</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderVideoList(videos = null) {
    const container = document.getElementById('videosList');
    if (!container || !currentPlaylistData || !currentPlaylistData.videos) return;

    const fromVidSelect = document.getElementById('fromVideoSelect');
    const currentFromIndex = fromVidSelect ? (parseInt(fromVidSelect.value, 10) || 1) : 1;

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
        const idx = parseInt(item.dataset.index, 10);
        if (fromVidSelect && !isNaN(idx)) {
          fromVidSelect.value = idx;
          updateRemainingStats(idx);
        }
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
      const fromVidSelect = document.getElementById('fromVideoSelect');
      const fromIdx = Math.max(1, Math.min(parseInt(fromVidSelect?.value, 10) || 1, currentPlaylistData.videos.length));
      const remVideos = currentPlaylistData.videos.slice(fromIdx - 1);
      targetSeconds = remVideos.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    }

    const adjustedSeconds = targetSeconds / speed;
    const days = Math.ceil(adjustedSeconds / (hours * 3600));

    const customDaysEl = document.getElementById('customDays');
    if (customDaysEl) {
      customDaysEl.textContent = isFinite(days) ? `${days} day${days !== 1 ? 's' : ''}` : '--';
    }
  }

  async function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });

      if (!response || !response.success || !response.data || response.data.length === 0) {
        historyList.innerHTML = '<p class="yt-pa-empty-text">No playlists analyzed yet</p>';
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
      historyList.innerHTML = '<p class="yt-pa-empty-text">Failed to load history</p>';
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

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
