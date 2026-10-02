// Content script - runs on YouTube pages
// Extracts playlist data from the YouTube DOM

(function() {
  'use strict';

  // Check if extension context is still valid (prevents errors after extension reload)
  function isContextValid() {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Intercept and suppress "Extension context invalidated" errors from orphaned scripts
  window.addEventListener('error', (event) => {
    if (event && event.message && event.message.includes('Extension context invalidated')) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return true;
    }
  }, true);

  // Listen for messages from popup/background
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isContextValid()) return;

      if (message.type === 'EXTRACT_PLAYLIST_DATA') {
        extractPlaylistData()
          .then(data => sendResponse({ success: true, data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }

      if (message.type === 'CHECK_PLAYLIST_PAGE') {
        const isPlaylist = isPlaylistPage();
        sendResponse({ isPlaylist, url: window.location.href });
        return false;
      }
    });
  }

  function isPlaylistPage() {
    const url = window.location.href;
    return url.includes('list=') || url.includes('/playlist');
  }

  function getPlaylistId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('list');
  }

  function parseDurationString(durationStr) {
    if (!durationStr) return 0;
    durationStr = durationStr.trim();

    const parts = durationStr.split(':').map(Number);

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      return parts[0];
    }
    return 0;
  }

  async function extractPlaylistData() {
    const playlistId = getPlaylistId();
    if (!playlistId) {
      throw new Error('No playlist found on this page. Navigate to a YouTube playlist first.');
    }

    await waitForElement('ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer');

    let playlistTitle = 'Unknown Playlist';
    const titleEl = document.querySelector(
      'yt-formatted-string.ytd-playlist-header-renderer, ' +
      '#header-description h3, ' +
      'h3.ytd-playlist-panel-renderer yt-formatted-string, ' +
      '#title yt-formatted-string.ytd-playlist-sidebar-primary-info-renderer'
    );
    if (titleEl) {
      playlistTitle = titleEl.textContent.trim();
    }

    let channelName = '';
    const channelEl = document.querySelector(
      '#owner-text a, ' +
      '.ytd-playlist-header-renderer #owner-text a, ' +
      'ytd-playlist-byline-renderer .yt-formatted-string'
    );
    if (channelEl) {
      channelName = channelEl.textContent.trim();
    }

    const isFullPlaylistPage = window.location.pathname === '/playlist';
    if (isFullPlaylistPage) {
      await scrollToLoadAllVideos();
    }

    const videos = extractVideoItems();

    if (videos.length === 0) {
      throw new Error('Could not extract video data. Make sure you are on a playlist page with visible videos.');
    }

    let totalVideoCount = videos.length;
    const statsEl = document.querySelector(
      '.ytd-playlist-header-renderer .metadata-stats yt-formatted-string, ' +
      '#stats yt-formatted-string, ' +
      '.ytd-playlist-sidebar-primary-info-renderer .stats yt-formatted-string'
    );
    if (statsEl) {
      const match = statsEl.textContent.match(/(\d[\d,]*)/);
      if (match) {
        totalVideoCount = parseInt(match[1].replace(/,/g, ''));
      }
    }

    return {
      playlistId,
      playlistTitle,
      channelName,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      totalVideoCount,
      loadedVideoCount: videos.length,
      videos
    };
  }

  function extractVideoItems() {
    const videos = [];

    let videoElements = document.querySelectorAll('ytd-playlist-video-renderer');

    if (videoElements.length === 0) {
      videoElements = document.querySelectorAll('ytd-playlist-panel-video-renderer');
    }

    videoElements.forEach((el, index) => {
      const titleEl = el.querySelector('#video-title');
      const title = titleEl ? titleEl.textContent.trim() : `Video ${index + 1}`;

      let durationSeconds = 0;
      const durationEl = el.querySelector(
        'ytd-thumbnail-overlay-time-status-renderer #text, ' +
        'span.ytd-thumbnail-overlay-time-status-renderer, ' +
        '.badge-shape-wiz__text'
      );
      if (durationEl) {
        const durationText = durationEl.textContent.trim();
        if (!durationText.match(/live|premiere|shorts/i)) {
          durationSeconds = parseDurationString(durationText);
        }
      }

      let videoChannel = '';
      const vidChannelEl = el.querySelector('#channel-name yt-formatted-string a, .ytd-channel-name a');
      if (vidChannelEl) {
        videoChannel = vidChannelEl.textContent.trim();
      }

      let videoUrl = '';
      const linkEl = el.querySelector('a#video-title, a.ytd-playlist-video-renderer');
      if (linkEl) {
        videoUrl = linkEl.href;
      }

      const isUnavailable = el.querySelector('[is-unavailable]') !== null ||
                            el.classList.contains('ytd-unavailable-video-renderer');

      videos.push({
        index: index + 1,
        title,
        durationSeconds,
        durationFormatted: formatTime(durationSeconds),
        channel: videoChannel,
        url: videoUrl,
        isUnavailable
      });
    });

    return videos;
  }

  function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  async function scrollToLoadAllVideos() {
    const maxScrollAttempts = 100;
    let lastCount = 0;
    let sameCountStreak = 0;

    for (let i = 0; i < maxScrollAttempts; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(800);

      const currentCount = document.querySelectorAll('ytd-playlist-video-renderer').length;
      if (currentCount === lastCount) {
        sameCountStreak++;
        if (sameCountStreak >= 3) break;
      } else {
        sameCountStreak = 0;
      }
      lastCount = currentCount;
    }

    window.scrollTo(0, 0);
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      if (!isContextValid()) return resolve(null);
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        if (!isContextValid()) {
          try { observer.disconnect(); } catch (e) {}
          resolve(null);
          return;
        }
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        try { observer.disconnect(); } catch (e) {}
        resolve(null);
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===== INLINE PANEL UI =====

  let panelOpen = false;

  function createPanel() {
    if (document.getElementById('yt-pa-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'yt-pa-panel';
    panel.innerHTML = `
      <div class="yt-pa-panel-header">
        <div class="yt-pa-panel-title">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#FF0000">
            <path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z"/>
          </svg>
          <span>Playlist Analyzer</span>
        </div>
        <button class="yt-pa-panel-close" id="yt-pa-close" title="Close">&times;</button>
      </div>
      <div class="yt-pa-top-nav" id="yt-pa-top-nav" style="display:none;">
        <div class="yt-pa-playlist-name" id="yt-pa-playlist-name"></div>
        <div class="yt-pa-tabs">
          <button class="yt-pa-tab active" data-tab="overview">Overview</button>
          <button class="yt-pa-tab" data-tab="speeds">Speeds</button>
          <button class="yt-pa-tab" data-tab="schedule">Schedule</button>
        </div>
      </div>
      <div class="yt-pa-panel-body" id="yt-pa-body">
        <div class="yt-pa-loading" id="yt-pa-loading">
          <div class="yt-pa-spinner"></div>
          <p>Analyzing playlist...</p>
        </div>
        <div class="yt-pa-no-playlist" id="yt-pa-no-playlist" style="display:none;">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="#666">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
          </svg>
          <p style="font-size:14px;font-weight:600;margin-top:8px;">No Playlist Found</p>
          <p style="font-size:12px;color:#888;margin-top:4px;">Navigate to a YouTube playlist to analyze it.</p>
        </div>
        <div class="yt-pa-results" id="yt-pa-results" style="display:none;">

          <!-- Overview Tab -->
          <div class="yt-pa-tab-content active" id="yt-pa-tc-overview">
            <div class="yt-pa-overview-list">
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Total Duration</span>
                <span class="yt-pa-ov-value yt-pa-ov-main" id="yt-pa-total-dur">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Videos</span>
                <span class="yt-pa-ov-value" id="yt-pa-total-vids">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Avg. Length</span>
                <span class="yt-pa-ov-value" id="yt-pa-avg-dur">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">At 2x Speed</span>
                <span class="yt-pa-ov-value yt-pa-ov-accent" id="yt-pa-2x-dur">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Shortest</span>
                <span class="yt-pa-ov-value yt-pa-ov-small" id="yt-pa-shortest">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Longest</span>
                <span class="yt-pa-ov-value yt-pa-ov-small" id="yt-pa-longest">--</span>
              </div>
            </div>
          </div>

          <!-- Speeds Tab -->
          <div class="yt-pa-tab-content" id="yt-pa-tc-speeds">
            <div id="yt-pa-speeds-list"></div>
            <div class="yt-pa-time-saved">
              <div class="yt-pa-ts-title">Time You Save</div>
              <div id="yt-pa-time-saved-grid" class="yt-pa-ts-grid"></div>
            </div>
          </div>

          <!-- Schedule Tab -->
          <div class="yt-pa-tab-content" id="yt-pa-tc-schedule">
            <div id="yt-pa-schedule-list"></div>
            <div class="yt-pa-cc-divider"></div>
            <div class="yt-pa-custom-calc">
              <div class="yt-pa-cc-title">Custom Calculator</div>
              <div class="yt-pa-cc-row">
                <div class="yt-pa-cc-input">
                  <label>Hours/day</label>
                  <select id="yt-pa-custom-hrs">
                    <option value="1" selected>1 hour</option>
                    <option value="2">2 hours</option>
                    <option value="3">3 hours</option>
                    <option value="4">4 hours</option>
                    <option value="5">5 hours</option>
                    <option value="6">6 hours</option>
                    <option value="7">7 hours</option>
                    <option value="8">8 hours</option>
                    <option value="9">9 hours</option>
                    <option value="10">10 hours</option>
                    <option value="12">12 hours</option>
                    <option value="14">14 hours</option>
                    <option value="16">16 hours</option>
                    <option value="18">18 hours</option>
                    <option value="20">20 hours</option>
                    <option value="24">24 hours</option>
                  </select>
                </div>
                <div class="yt-pa-cc-input">
                  <label>Speed</label>
                  <select id="yt-pa-custom-spd">
                    <option value="1">1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5" selected>1.5x</option>
                    <option value="1.75">1.75x</option>
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                  </select>
                </div>
              </div>
              <div class="yt-pa-cc-result">
                <span id="yt-pa-custom-days" class="yt-pa-cc-days">--</span>
                <span>days to complete</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Close button
    document.getElementById('yt-pa-close').addEventListener('click', togglePanel);

    // Tab switching
    panel.querySelectorAll('.yt-pa-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.yt-pa-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.yt-pa-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`yt-pa-tc-${tab.dataset.tab}`).classList.add('active');
      });
    });

    // Custom calculator
    const customHrs = document.getElementById('yt-pa-custom-hrs');
    const customSpd = document.getElementById('yt-pa-custom-spd');
    customHrs.addEventListener('change', updateCustomCalc);
    customSpd.addEventListener('change', updateCustomCalc);
  }

  let analysisData = null;
  let playlistData = null;

  function togglePanel() {
    if (!isContextValid()) return;
    panelOpen = !panelOpen;
    const panel = document.getElementById('yt-pa-panel');
    const btn = document.getElementById('yt-playlist-analyzer-btn');

    if (panelOpen) {
      createPanel();
      const p = document.getElementById('yt-pa-panel');
      if (p) p.classList.add('open');
      if (btn) btn.classList.add('active');
      runAnalysis();
    } else {
      if (panel) {
        panel.classList.remove('open');
        if (btn) btn.classList.remove('active');
      }
    }
  }

  async function runAnalysis() {
    if (!isContextValid()) return;
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const results = document.getElementById('yt-pa-results');
    const topNav = document.getElementById('yt-pa-top-nav');

    loading.style.display = 'flex';
    noPlaylist.style.display = 'none';
    results.style.display = 'none';
    if (topNav) topNav.style.display = 'none';

    if (!isPlaylistPage()) {
      loading.style.display = 'none';
      noPlaylist.style.display = 'flex';
      return;
    }

    try {
      playlistData = await extractPlaylistData();
      const videos = playlistData.videos;

      if (!videos || videos.length === 0) {
        loading.style.display = 'none';
        noPlaylist.style.display = 'flex';
        return;
      }

      // Run analysis locally
      const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
      const speeds = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const speedAnalysis = speeds.map(speed => ({
        speed,
        totalSeconds: Math.round(totalSeconds / speed),
        formatted: formatDuration(Math.round(totalSeconds / speed))
      }));

      const avgSeconds = Math.round(totalSeconds / videos.length);
      const sorted = [...videos].sort((a, b) => a.durationSeconds - b.durationSeconds);

      const dailySchedules = [
        { hoursPerDay: 0.5, label: '30 min/day' },
        { hoursPerDay: 1, label: '1 hr/day' },
        { hoursPerDay: 2, label: '2 hrs/day' },
        { hoursPerDay: 3, label: '3 hrs/day' },
        { hoursPerDay: 5, label: '5 hrs/day' }
      ].map(s => ({
        ...s,
        days: Math.ceil(totalSeconds / (s.hoursPerDay * 3600)),
        daysAt1_5x: Math.ceil((totalSeconds / 1.5) / (s.hoursPerDay * 3600)),
        daysAt2x: Math.ceil((totalSeconds / 2) / (s.hoursPerDay * 3600))
      }));

      analysisData = {
        totalVideos: videos.length,
        totalDuration: formatDuration(totalSeconds),
        totalSeconds,
        averageDuration: formatDuration(avgSeconds),
        shortest: sorted[0],
        longest: sorted[sorted.length - 1],
        speedAnalysis,
        dailySchedules
      };

      renderInlineResults();
      loading.style.display = 'none';
      if (topNav) topNav.style.display = 'block';
      results.style.display = 'block';

    } catch (err) {
      loading.style.display = 'none';
      noPlaylist.style.display = 'flex';
      noPlaylist.querySelector('p:first-of-type').textContent = 'Error';
      noPlaylist.querySelector('p:last-of-type').textContent = err.message;
    }
  }

  function renderInlineResults() {
    if (!analysisData || !playlistData) return;

    document.getElementById('yt-pa-playlist-name').textContent = playlistData.playlistTitle;
    document.getElementById('yt-pa-total-dur').textContent = analysisData.totalDuration;
    document.getElementById('yt-pa-total-vids').textContent = analysisData.totalVideos;
    document.getElementById('yt-pa-avg-dur').textContent = analysisData.averageDuration;

    const at2x = analysisData.speedAnalysis.find(s => s.speed === 2);
    document.getElementById('yt-pa-2x-dur').textContent = at2x ? at2x.formatted : '--';

    // Shortest / longest
    if (analysisData.shortest) {
      const s = analysisData.shortest;
      document.getElementById('yt-pa-shortest').textContent =
        `${formatTime(s.durationSeconds)} — ${s.title.substring(0, 35)}${s.title.length > 35 ? '...' : ''}`;
    }
    if (analysisData.longest) {
      const l = analysisData.longest;
      document.getElementById('yt-pa-longest').textContent =
        `${formatTime(l.durationSeconds)} — ${l.title.substring(0, 35)}${l.title.length > 35 ? '...' : ''}`;
    }

    // Speeds
    const speedsList = document.getElementById('yt-pa-speeds-list');
    speedsList.innerHTML = analysisData.speedAnalysis.map(item => {
      const pct = (item.totalSeconds / analysisData.totalSeconds) * 100;
      const rec = item.speed === 1.5;
      return `<div class="yt-pa-speed-row ${rec ? 'recommended' : ''}">
        <span class="yt-pa-speed-badge">${item.speed}x</span>
        <div class="yt-pa-speed-bar-bg"><div class="yt-pa-speed-bar-fill" style="width:${pct}%"></div></div>
        <span class="yt-pa-speed-dur">${item.formatted}</span>
      </div>`;
    }).join('');

    // Time saved
    const tsGrid = document.getElementById('yt-pa-time-saved-grid');
    tsGrid.innerHTML = [1.25, 1.5, 2, 3].map(sp => {
      const saved = analysisData.totalSeconds - Math.round(analysisData.totalSeconds / sp);
      return `<div class="yt-pa-ts-item">
        <div class="yt-pa-ts-speed">At ${sp}x</div>
        <div class="yt-pa-ts-value">${formatDuration(saved)}</div>
      </div>`;
    }).join('');

    // Schedule
    const schedList = document.getElementById('yt-pa-schedule-list');
    schedList.innerHTML = `
      <div class="yt-pa-sched-header">
        <span>Watch Time</span><span>1x</span><span>1.5x</span><span>2x</span>
      </div>
      ${analysisData.dailySchedules.map(s => `
        <div class="yt-pa-sched-row">
          <span class="yt-pa-sched-label">${s.label}</span>
          <span>${s.days}d</span>
          <span class="yt-pa-highlight">${s.daysAt1_5x}d</span>
          <span>${s.daysAt2x}d</span>
        </div>
      `).join('')}
    `;

    updateCustomCalc();
  }

  function updateCustomCalc() {
    if (!analysisData) return;
    const hrs = parseFloat(document.getElementById('yt-pa-custom-hrs')?.value) || 1;
    const spd = parseFloat(document.getElementById('yt-pa-custom-spd')?.value) || 1;
    const days = Math.ceil((analysisData.totalSeconds / spd) / (hrs * 3600));
    const el = document.getElementById('yt-pa-custom-days');
    if (el) el.textContent = days;
  }

  // ===== FLOATING BUTTON =====

  function injectFloatingButton() {
    if (!isContextValid()) return;
    if (document.getElementById('yt-playlist-analyzer-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'yt-playlist-analyzer-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
        <path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z"/>
      </svg>
      <svg class="yt-pa-clock" viewBox="0 0 24 24" width="14" height="14" fill="white">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
      </svg>
      <span class="yt-pa-tooltip">Playlist Analyzer</span>
    `;
    btn.title = 'YouTube Playlist Analyzer';
    btn.addEventListener('click', () => {
      if (!isContextValid()) return;
      togglePanel();
    });
    document.body.appendChild(btn);
  }

  // Watch for navigation changes (YouTube is SPA)
  function watchNavigation() {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (!isContextValid()) {
        try { observer.disconnect(); } catch (e) {}
        return;
      }
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        // Close panel on navigation
        if (panelOpen) {
          panelOpen = false;
          const panel = document.getElementById('yt-pa-panel');
          const btn = document.getElementById('yt-playlist-analyzer-btn');
          if (panel) panel.classList.remove('open');
          if (btn) btn.classList.remove('active');
        }
        setTimeout(() => {
          if (!isContextValid()) return;
          if (!document.getElementById('yt-playlist-analyzer-btn')) {
            injectFloatingButton();
          }
        }, 1500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize
  injectFloatingButton();
  watchNavigation();
})();
