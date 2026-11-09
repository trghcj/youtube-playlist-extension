// YouTube Playlist Analyzer - Popup Script
// Depends on ../lib/core.js (loaded first in popup.html) for the YTPA helpers.

document.addEventListener('DOMContentLoaded', async () => {
  const {
    SPEEDS, TIME_SAVED_SPEEDS, DEFAULT_SETTINGS,
    formatTime, formatDuration, escapeHtml, daysToFinish, formatDays,
    videoIdFromUrl, analyzePlaylist, clampIndex, computeRemaining,
    getVisibleVideos, cardSpeed
  } = YTPA;

  // DOM Elements
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const statusTextEl = $('statusText');
  const notPlaylistEl = $('notPlaylist');
  const idleStateEl = $('idleState');
  const errorStateEl = $('errorState');
  const errorTitleEl = $('errorTitle');
  const errorTextEl = $('errorText');
  const mainContentEl = $('mainContent');
  const retryBtn = $('retryBtn');
  const historyPanel = $('historyPanel');
  const settingsPanel = $('settingsPanel');
  const fromVideoSelect = $('fromVideoSelect');
  const customHours = $('customHours');
  const customSpeed = $('customSpeed');
  const scheduleScope = $('scheduleScope');

  let settings = { ...DEFAULT_SETTINGS };
  let currentAnalysis = null;
  let currentPlaylistData = null;
  let activeTabId = null;
  let pollTimer = null;
  let listView = { query: '', sort: 'index' };
  let followPlaying = true;   // "From" follows the playing video until the user picks another one
  let playingIndex = 0;       // video of this playlist currently open in the tab (0 = none)
  let liveInfo = null;        // { elapsed, rate } for the playing video
  let customSpeedTouched = false;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  window.addEventListener('unload', stopPolling);

  // Tab navigation
  document.querySelectorAll('.yt-pa-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.yt-pa-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.yt-pa-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const targetContent = $(`tab-${tab.dataset.tab}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // Panel navigation
  $('historyBtn').addEventListener('click', () => {
    historyPanel.classList.toggle('hidden');
    settingsPanel.classList.add('hidden');
    if (!historyPanel.classList.contains('hidden')) loadHistory();
  });

  $('settingsBtn').addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    historyPanel.classList.add('hidden');
  });

  document.querySelectorAll('.yt-pa-panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.close);
      if (target) target.classList.add('hidden');
    });
  });

  // Retry / analyze buttons
  retryBtn.addEventListener('click', () => {
    if (typeof retryBtn.onRetry === 'function') retryBtn.onRetry();
    else startAnalysis();
  });
  $('analyzeBtn').addEventListener('click', () => startAnalysis());
  $('idleAnalyzeBtn').addEventListener('click', () => startAnalysis());

  // Clear history
  $('clearHistoryBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    loadHistory();
  });

  // Remaining watch time dropdown
  fromVideoSelect.addEventListener('change', () => {
    followPlaying = parseInt(fromVideoSelect.value, 10) === playingIndex;
    updateRemainingStats();
    highlightCurrentVideo();
  });

  // Custom schedule calculator & scope selector
  customHours.addEventListener('change', updateCustomSchedule);
  customSpeed.addEventListener('change', () => {
    customSpeedTouched = true;
    updateCustomSchedule();
  });
  scheduleScope.addEventListener('change', updateCustomSchedule);

  // Video search + sort (they combine)
  $('videoSearch').addEventListener('input', (e) => {
    listView.query = e.target.value;
    renderVideoList();
  });

  document.querySelectorAll('.yt-pa-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.yt-pa-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      listView.sort = btn.dataset.sort;
      renderVideoList();
    });
  });

  $('videosList').addEventListener('click', onVideoListClick);

  // Settings: load BEFORE analysing so "Save history" / "Auto-analyze" are respected
  settings = await YTPA.loadSettings();
  applySettingsToUI();
  ['defaultSpeed', 'autoAnalyze', 'showFloatingBtn', 'saveHistory'].forEach(id => {
    $(id).addEventListener('change', saveSettings);
  });

  if (settings.autoAnalyze) {
    startAnalysis();
  } else {
    showView('idle');
  }

  function setRetry(label, handler) {
    retryBtn.textContent = label;
    retryBtn.onRetry = handler;
  }

  function showRefreshRequired(tabId) {
    errorTitleEl.textContent = 'Refresh Required';
    errorTextEl.textContent = 'Please refresh this YouTube page (F5) once so the extension can connect.';
    setRetry('Refresh YouTube Page', async () => {
      await chrome.tabs.reload(tabId);
      window.close();
    });
    showView('error');
  }

  async function startAnalysis() {
    stopPolling();
    setRetry('Try Again', null);
    errorTitleEl.textContent = 'Oops!';

    showView('status');
    statusTextEl.textContent = 'Checking page...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let url = null;
      try { url = tab && tab.url ? new URL(tab.url) : null; } catch (e) { url = null; }

      if (!url || url.hostname !== 'www.youtube.com') {
        showView('notPlaylist');
        return;
      }
      activeTabId = tab.id;

      const isWatch = url.pathname === '/watch' || url.pathname.startsWith('/shorts/');
      const hasPlaylist = url.searchParams.has('list') || url.pathname === '/playlist';

      if (!isWatch && !hasPlaylist) {
        showView('notPlaylist');
        return;
      }

      if (isWatch && !hasPlaylist) {
        await startSingleVideoMode(tab.id);
        return;
      }

      await startPlaylistMode(tab, isWatch);

    } catch (error) {
      console.warn('Analysis error handled:', error);
      errorTextEl.textContent = error.message || 'Something went wrong. Make sure you\'re on a YouTube playlist or video page.';
      showView('error');
    }
  }

  // ===== SINGLE VIDEO MODE =====

  async function startSingleVideoMode(tabId) {
    $('headerTitle').textContent = 'Video Analyzer';
    $('topNav').classList.add('hidden');
    $('playlistTabsWrapper').style.display = 'none';
    $('videoResults').style.display = 'flex';

    initVideoModeDOM(tabId);

    const ok = await updateSingleVideoUI(tabId);
    if (!ok) return;

    showView('main');

    // Poll every second while the popup is open to keep progress and clocks live
    pollTimer = setInterval(() => updateSingleVideoUI(tabId), 1000);
  }

  function initVideoModeDOM(tabId) {
    const speedsTable = $('vidSpeedsTable');
    const tsGrid = $('vidTimeSavedGrid');

    if (speedsTable && !speedsTable.hasChildNodes()) {
      speedsTable.innerHTML = SPEEDS.map(sp => `
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
      tsGrid.innerHTML = TIME_SAVED_SPEEDS.map(sp => `
        <div class="yt-pa-ts-row" data-speed="${sp}">
          <span class="yt-pa-ts-label">At ${sp}×</span>
          <span class="yt-pa-ts-val">--</span>
        </div>
      `).join('');
    }
  }

  function clockAfter(seconds) {
    return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function updateSingleVideoUI(tabId) {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_DATA' });
    } catch (connErr) {
      console.warn('Content script not reachable:', connErr?.message);
      stopPolling();
      showRefreshRequired(tabId);
      return false;
    }

    if (!response || !response.success || !response.data) {
      errorTitleEl.textContent = 'No Video Found';
      errorTextEl.textContent = response?.error || 'Make sure a video is playing on this page.';
      showView('error');
      stopPolling();
      return false;
    }

    const { title, channel, currentTime, duration, playbackRate } = response.data;
    if (isNaN(duration) || duration <= 0) return true;

    const vidTitle = $('vidTitle');
    const vidChannel = $('vidChannel');
    if (vidTitle.textContent !== title) vidTitle.textContent = title || 'YouTube Video';
    if (vidChannel.textContent !== channel) vidChannel.textContent = channel || '';

    const currentSpeed = playbackRate || 1;
    const remainingSeconds = Math.max(0, duration - currentTime);
    const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

    $('vidProgressFill').style.width = `${progressPercent.toFixed(1)}%`;
    $('vidCurrentTime').textContent = formatTime(currentTime);
    $('vidTotalTime').textContent = formatTime(duration);

    const adjustedRemaining = remainingSeconds / currentSpeed;
    $('vidEndClock').textContent = clockAfter(adjustedRemaining);
    $('vidRemainText').textContent = `${formatDuration(adjustedRemaining)} left (${currentSpeed}×)`;

    $('vidSpeedsTable').querySelectorAll('.yt-pa-vid-speed-row').forEach(row => {
      const sp = parseFloat(row.dataset.speed);
      if (isNaN(sp)) return;
      const spRemaining = Math.max(0, remainingSeconds / sp);
      const isCurrent = Math.abs(currentSpeed - sp) < 0.05;

      row.classList.toggle('active', isCurrent);
      row.querySelector('.yt-pa-vid-speed-time').textContent = `${formatDuration(spRemaining)} left`;
      row.querySelector('.yt-pa-vid-speed-finish').textContent = `Ends at ${clockAfter(spRemaining)}`;

      const btnEl = row.querySelector('.yt-pa-vid-set-speed-btn');
      btnEl.classList.toggle('active', isCurrent);
      btnEl.textContent = isCurrent ? 'Active' : `Set ${sp}×`;
    });

    $('vidTimeSavedGrid').querySelectorAll('.yt-pa-ts-row').forEach(item => {
      const sp = parseFloat(item.dataset.speed);
      if (isNaN(sp)) return;
      const saved = Math.max(0, remainingSeconds - remainingSeconds / sp);
      item.querySelector('.yt-pa-ts-val').textContent = formatDuration(saved);
    });

    return true;
  }

  // ===== PLAYLIST MODE =====

  async function startPlaylistMode(tab, isWatch) {
    $('headerTitle').textContent = 'Playlist Analyzer';
    $('topNav').classList.remove('hidden');
    $('playlistTabsWrapper').style.display = 'block';
    $('videoResults').style.display = 'none';

    statusTextEl.textContent = 'Extracting playlist data...';

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PLAYLIST_DATA' });
    } catch (connErr) {
      console.warn('Content script not yet connected to tab:', connErr?.message);
      showRefreshRequired(tab.id);
      return;
    }

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to extract playlist data');
    }

    currentPlaylistData = response.data;
    const count = currentPlaylistData.videos ? currentPlaylistData.videos.length : 0;
    statusTextEl.textContent = `Analyzing ${count} videos...`;

    currentAnalysis = analyzePlaylist(currentPlaylistData.videos);
    followPlaying = true;
    playingIndex = isWatch ? (currentPlaylistData.currentVideoIndex || 0) : 0;
    liveInfo = null;

    if (settings.saveHistory) {
      chrome.runtime.sendMessage({
        type: 'SAVE_HISTORY',
        data: {
          playlistTitle: currentPlaylistData.playlistTitle,
          playlistUrl: currentPlaylistData.playlistUrl,
          totalVideos: currentAnalysis.totalVideos,
          totalDuration: currentAnalysis.totalDuration,
          totalSeconds: currentAnalysis.totalSeconds
        }
      }).catch(() => {});
    }

    renderResults();
    showView('main');

    // Live overview: follow the playing video and count down its remaining time
    pollTimer = setInterval(pollPlaylistLive, 1000);
    pollPlaylistLive();
  }

  async function pollPlaylistLive() {
    if (!currentPlaylistData || activeTabId === null) return;
    let response;
    try {
      response = await chrome.tabs.sendMessage(activeTabId, { type: 'GET_VIDEO_DATA' });
    } catch (e) {
      response = null; // tab is reloading / not a watch page: keep last values
    }

    const d = response && response.success ? response.data : null;
    if (!d || d.playlistId !== currentPlaylistData.playlistId) {
      if (liveInfo || playingIndex) {
        liveInfo = null;
        playingIndex = 0;
        updateRemainingStats();
        highlightCurrentVideo();
      }
      return;
    }

    const idx = currentPlaylistData.videos.findIndex(v => videoIdFromUrl(v.url) === d.videoId) + 1;
    if (idx !== playingIndex) {
      playingIndex = idx;
      if (followPlaying && idx > 0) fromVideoSelect.value = idx;
      highlightCurrentVideo();
    }
    liveInfo = idx > 0
      ? { elapsed: (d.isAd || !(d.duration > 0)) ? 0 : d.currentTime, rate: d.playbackRate || 1 }
      : null;
    updateRemainingStats();
  }

  function showView(view) {
    [statusEl, notPlaylistEl, idleStateEl, errorStateEl, mainContentEl].forEach(el => {
      if (el) el.classList.add('hidden');
    });

    if (view !== 'main') $('topNav').classList.add('hidden');

    const map = { status: statusEl, notPlaylist: notPlaylistEl, idle: idleStateEl, error: errorStateEl, main: mainContentEl };
    if (map[view]) map[view].classList.remove('hidden');
  }

  function extremeHtml(v) {
    const title = v.title.length > 36 ? v.title.substring(0, 34) + '...' : v.title;
    return `
      <span class="yt-pa-ov-ext-title" title="${escapeHtml(v.title)}">${escapeHtml(title)}</span>
      <span class="yt-pa-ov-ext-time">${formatDuration(v.durationSeconds)}</span>
    `;
  }

  function renderResults() {
    if (!currentAnalysis || !currentPlaylistData) return;
    const a = currentAnalysis;
    const p = currentPlaylistData;

    $('playlistTitle').textContent = p.playlistTitle || 'YouTube Playlist';

    // Video dropdown
    fromVideoSelect.innerHTML = p.videos.map(v => {
      const cleanTitle = (v.title || '').replace(/\s+/g, ' ').trim();
      const shortTitle = cleanTitle.length > 24 ? cleanTitle.substring(0, 22) + '…' : cleanTitle;
      const dur = v.durationFormatted ? ` (${v.durationFormatted})` : '';
      return `<option value="${v.index}">Video ${v.index}: ${escapeHtml(shortTitle)}${dur}</option>`;
    }).join('');
    fromVideoSelect.value = p.currentVideoIndex || 1;

    // Overview stats
    $('totalDuration').textContent = a.totalDuration || '--';
    let videosText = String(a.totalVideos);
    if (p.totalVideoCount > p.loadedVideoCount) {
      videosText = `${p.loadedVideoCount} of ${p.totalVideoCount} loaded`;
    } else if (a.untimedVideos > 0) {
      videosText = `${a.totalVideos} (${a.untimedVideos} unavailable)`;
    }
    $('totalVideos').textContent = videosText;
    $('avgDuration').textContent = a.averageDuration || '--';
    const at2x = a.speedAnalysis.find(s => s.speed === 2);
    $('at2xDuration').textContent = at2x ? at2x.formatted : '--';

    $('shortestVideo').innerHTML = a.shortest ? extremeHtml(a.shortest) : '--';
    $('longestVideo').innerHTML = a.longest ? extremeHtml(a.longest) : '--';

    renderSpeeds();
    renderSchedule();
    renderVideoList();
    updateRemainingStats();
  }

  function getFromIndex() {
    return clampIndex(fromVideoSelect.value, currentPlaylistData ? currentPlaylistData.videos.length : 1);
  }

  function liveElapsedFor(idx) {
    return (liveInfo && idx === playingIndex) ? liveInfo : null;
  }

  function setText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function updateRemainingStats() {
    if (!currentPlaylistData || !currentPlaylistData.videos || currentPlaylistData.videos.length === 0) return;
    const fromIdx = getFromIndex();
    const live = liveElapsedFor(fromIdx);
    const rem = computeRemaining(currentPlaylistData.videos, fromIdx, live ? live.elapsed : 0);

    const badgeEl = $('currentVideoBadge');
    badgeEl.classList.toggle('live', !!live);
    if (live) {
      setText('currentVideoBadge', `Now at Video ${fromIdx}`);
    } else if (fromIdx > 1) {
      setText('currentVideoBadge', `From Video ${fromIdx}`);
    } else {
      setText('currentVideoBadge', `Full Playlist (${currentPlaylistData.videos.length} vids)`);
    }

    const cardSp = cardSpeed(settings.defaultSpeed);
    setText('remainingDuration', formatDuration(rem.seconds));
    setText('remainingCount', `${rem.count} vids left`);
    setText('remainingCardLabel', `At ${cardSp}×`);
    setText('remainingAt1_5x', formatDuration(rem.seconds / cardSp));
    setText('remainingAt2x', formatDuration(rem.seconds / 2));

    const liveRow = $('remainingLiveRow');
    liveRow.style.display = live ? 'flex' : 'none';
    if (live) {
      const atRate = rem.seconds / live.rate;
      setText('remainingLiveFinish', `${formatDuration(atRate)} at ${live.rate}× · ends ${clockAfter(atRate)}`);
    }

    updateCustomSchedule();
  }

  function highlightCurrentVideo() {
    const fromIdx = getFromIndex();
    $('videosList').querySelectorAll('.video-item').forEach(item => {
      const idx = parseInt(item.dataset.index, 10);
      item.classList.toggle('current-video', idx === fromIdx);
      item.classList.toggle('watched-video', idx < fromIdx);
      item.classList.toggle('playing-video', idx === playingIndex);
    });
  }

  function renderSpeeds() {
    const a = currentAnalysis;
    if (!a) return;
    const totalSeconds = a.totalSeconds || 0;
    const preferred = parseFloat(settings.defaultSpeed) || 1.5;

    $('speedsList').innerHTML = a.speedAnalysis.map(item => {
      const percentage = totalSeconds > 0 ? (item.totalSeconds / totalSeconds) * 100 : 0;
      return `
        <div class="yt-pa-speed-row ${item.speed === preferred ? 'active' : ''}">
          <span class="yt-pa-speed-label">${item.speed}×</span>
          <div class="yt-pa-speed-bar-bg">
            <div class="yt-pa-speed-bar-fill" style="width: ${percentage}%"></div>
          </div>
          <span class="yt-pa-speed-val">${item.formatted}</span>
        </div>
      `;
    }).join('');

    $('timeSaved').innerHTML = TIME_SAVED_SPEEDS.map(speed => {
      const saved = totalSeconds - Math.round(totalSeconds / speed);
      return `
        <div class="yt-pa-ts-row">
          <span class="yt-pa-ts-label">At ${speed}×</span>
          <span class="yt-pa-ts-val">${formatDuration(saved)}</span>
        </div>
      `;
    }).join('');
  }

  function renderSchedule() {
    if (!currentAnalysis) return;
    $('scheduleList').innerHTML = `
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

  function renderVideoList() {
    const container = $('videosList');
    if (!currentPlaylistData || !currentPlaylistData.videos) return;

    const fromIdx = getFromIndex();
    const visible = getVisibleVideos(currentPlaylistData.videos, listView.query, listView.sort);

    if (visible.length === 0) {
      container.innerHTML = '<p class="yt-pa-empty-text">No videos match your search</p>';
      return;
    }

    container.innerHTML = visible.map(video => {
      const idx = video.index || 0;
      const classes = [
        'video-item',
        video.isUnavailable ? 'unavailable' : '',
        idx === fromIdx ? 'current-video' : '',
        idx < fromIdx ? 'watched-video' : '',
        idx === playingIndex ? 'playing-video' : '',
        video.url ? 'has-link' : ''
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}" data-index="${idx}" title="${escapeHtml(video.title || '')}">
          <button type="button" class="video-index" data-index="${idx}"
                  ${video.url ? '' : 'disabled'} aria-label="Play video ${idx}">${idx}</button>
          <span class="video-title">${escapeHtml(video.title || 'Untitled')}</span>
          <span class="video-duration">${video.durationFormatted || '--'}</span>
        </div>
      `;
    }).join('');
  }

  // Click a video: play it in the current YouTube tab (Ctrl/Cmd+click: new tab)
  async function onVideoListClick(e) {
    const item = e.target.closest('.video-item');
    if (!item || !currentPlaylistData) return;
    const idx = parseInt(item.dataset.index, 10);
    const video = currentPlaylistData.videos[idx - 1];
    if (!video || !video.url) return;

    if (e.ctrlKey || e.metaKey) {
      chrome.tabs.create({ url: video.url });
      return;
    }

    followPlaying = true;
    fromVideoSelect.value = idx;
    updateRemainingStats();
    highlightCurrentVideo();

    try {
      const res = await chrome.tabs.sendMessage(activeTabId, { type: 'OPEN_VIDEO', url: video.url, index: idx });
      if (res && res.success) return;
    } catch (err) { /* fall through to a normal navigation */ }
    chrome.tabs.update(activeTabId, { url: video.url });
  }

  function updateCustomSchedule() {
    if (!currentAnalysis || !currentPlaylistData) return;

    const hours = parseFloat(customHours.value) || 1;
    const speed = parseFloat(customSpeed.value) || 1;

    let targetSeconds = currentAnalysis.totalSeconds || 0;
    if (scheduleScope.value === 'remaining') {
      const fromIdx = getFromIndex();
      const live = liveElapsedFor(fromIdx);
      targetSeconds = computeRemaining(currentPlaylistData.videos, fromIdx, live ? live.elapsed : 0).seconds;
    }

    setText('customDays', formatDays(daysToFinish(targetSeconds, speed, hours)));
  }

  // ===== HISTORY =====

  async function loadHistory() {
    const historyList = $('historyList');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });

      if (!response || !response.success || !response.data || response.data.length === 0) {
        historyList.innerHTML = '<p class="yt-pa-empty-text">No playlists analyzed yet</p>';
        return;
      }

      historyList.innerHTML = response.data.map(item => `
        <div class="history-item" data-url="${escapeHtml(item.playlistUrl)}">
          <div class="history-title">${escapeHtml(item.playlistTitle || 'Playlist')}</div>
          <div class="history-meta">
            <span>${escapeHtml(item.totalVideos)} videos</span>
            <span>${escapeHtml(item.totalDuration)}</span>
            <span>${escapeHtml(new Date(item.analyzedAt).toLocaleDateString())}</span>
          </div>
        </div>
      `).join('');

      historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
          const url = item.dataset.url;
          if (url && url.startsWith('https://www.youtube.com/')) {
            chrome.tabs.create({ url });
          }
        });
      });
    } catch (e) {
      console.warn('Failed to load history:', e);
      historyList.innerHTML = '<p class="yt-pa-empty-text">Failed to load history</p>';
    }
  }

  // ===== SETTINGS =====

  function applySettingsToUI() {
    $('defaultSpeed').value = settings.defaultSpeed;
    $('autoAnalyze').checked = !!settings.autoAnalyze;
    $('showFloatingBtn').checked = !!settings.showFloatingBtn;
    $('saveHistory').checked = !!settings.saveHistory;

    if (!customSpeedTouched) {
      customSpeed.value = String(parseFloat(settings.defaultSpeed) || 1.5);
      if (!customSpeed.value) customSpeed.value = '1.5';
    }
  }

  async function saveSettings() {
    settings = {
      defaultSpeed: $('defaultSpeed').value,
      autoAnalyze: $('autoAnalyze').checked,
      showFloatingBtn: $('showFloatingBtn').checked,
      saveHistory: $('saveHistory').checked
    };
    try {
      await chrome.storage.local.set({ settings });
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
    applySettingsToUI();
    if (currentAnalysis) {
      renderSpeeds();
      updateRemainingStats();
    }
  }
});
