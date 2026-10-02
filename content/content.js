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

  let activeWatchMode = null; // 'video' | 'playlist' | null

  function isDedicatedPlaylistPage() {
    return window.location.pathname === '/playlist';
  }

  function isVideoWatchPage() {
    const path = window.location.pathname;
    return path === '/watch' || path.startsWith('/shorts/');
  }

  function hasPlaylistParam() {
    const params = new URLSearchParams(window.location.search);
    return !!params.get('list');
  }

  function isPlaylistPage() {
    if (isDedicatedPlaylistPage()) return true;
    if (isVideoWatchPage()) {
      return activeWatchMode === 'playlist' && hasPlaylistParam();
    }
    return hasPlaylistParam();
  }

  function getPlaylistId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('list');
  }

  function isVideoPage() {
    if (isDedicatedPlaylistPage()) return false;
    if (isVideoWatchPage()) {
      return activeWatchMode !== 'playlist';
    }
    return false;
  }

  function getVideoMeta() {
    let title = '';
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, ytd-video-primary-info-renderer #title h1, h1.title');
    if (titleEl) {
      title = titleEl.textContent.trim();
    } else {
      title = document.title.replace(' - YouTube', '').trim();
    }

    let channel = '';
    const channelEl = document.querySelector('#owner-text a, #channel-name a, ytd-channel-name a, .ytd-video-owner-renderer a');
    if (channelEl) {
      channel = channelEl.textContent.trim();
    }
    return { title, channel };
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

    const currentVideoIndex = getCurrentVideoIndex(videos);

    return {
      playlistId,
      playlistTitle,
      channelName,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      totalVideoCount,
      loadedVideoCount: videos.length,
      currentVideoIndex,
      videos
    };
  }

  function getCurrentVideoIndex(videos) {
    const urlParams = new URLSearchParams(window.location.search);

    // 1. Try URL &index= parameter
    const urlIndex = parseInt(urlParams.get('index'), 10);
    if (!isNaN(urlIndex) && urlIndex >= 1 && (!videos || urlIndex <= videos.length)) {
      return urlIndex;
    }

    // 2. Try URL &v= video ID parameter
    const currentVideoId = urlParams.get('v');
    if (currentVideoId && videos && videos.length > 0) {
      const matchIndex = videos.findIndex(v => v.url && v.url.includes(currentVideoId));
      if (matchIndex !== -1) {
        return matchIndex + 1;
      }
    }

    // 3. Try DOM selected queue item
    if (videos && videos.length > 0) {
      const selIdx = videos.findIndex(v => v.isSelected);
      if (selIdx !== -1) {
        return selIdx + 1;
      }
    }

    return 1;
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

      const isSelected = el.hasAttribute('selected') ||
                         el.getAttribute('aria-selected') === 'true' ||
                         el.querySelector('ytd-thumbnail-overlay-now-playing-renderer') !== null;

      videos.push({
        index: index + 1,
        title,
        durationSeconds,
        durationFormatted: formatTime(durationSeconds),
        channel: videoChannel,
        url: videoUrl,
        isUnavailable,
        isSelected
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

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  function createPanel() {
    if (document.getElementById('yt-pa-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'yt-pa-panel';
    panel.innerHTML = `
      <div class="yt-pa-panel-header">
        <div class="yt-pa-panel-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#FF0000">
            <path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z"/>
          </svg>
          <span id="yt-pa-header-title">Playlist Analyzer</span>
        </div>
        <div class="yt-pa-header-actions">
          <button id="yt-pa-mode-toggle" class="yt-pa-mode-toggle" style="display:none;"></button>
          <button class="yt-pa-panel-close" id="yt-pa-close" title="Close" aria-label="Close">&times;</button>
        </div>
      </div>
      <div class="yt-pa-top-nav" id="yt-pa-top-nav" style="display:none;">
        <div class="yt-pa-playlist-name" id="yt-pa-playlist-name"></div>
        <div class="yt-pa-tabs">
          <button class="yt-pa-tab active" data-tab="overview">Overview</button>
          <button class="yt-pa-tab" data-tab="speeds">Speeds</button>
          <button class="yt-pa-tab" data-tab="schedule">Schedule</button>
          <button class="yt-pa-tab" data-tab="videos">Videos</button>
        </div>
      </div>
      <div class="yt-pa-panel-body" id="yt-pa-body">
        <div class="yt-pa-loading" id="yt-pa-loading">
          <div class="yt-pa-spinner"></div>
          <p>Analyzing playlist...</p>
        </div>
        <div class="yt-pa-no-playlist" id="yt-pa-no-playlist" style="display:none;">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="#717171">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
          </svg>
          <p class="yt-pa-state-title">No Playlist Found</p>
          <p class="yt-pa-state-sub">Open any YouTube playlist or video to analyze.</p>
        </div>
        <div class="yt-pa-results" id="yt-pa-results" style="display:none;">

          <!-- Overview Tab -->
          <div class="yt-pa-tab-content active" id="yt-pa-tc-overview">
            <div class="yt-pa-rem-card" id="yt-pa-rem-card">
              <div class="yt-pa-rem-header">
                <span class="yt-pa-rem-badge" id="yt-pa-rem-badge">Now at Video 1</span>
                <div class="yt-pa-rem-ctrl">
                  <span class="yt-pa-rem-label-from">From:</span>
                  <select id="yt-pa-from-vid-select" class="yt-pa-from-vid-select"></select>
                </div>
              </div>
              <div class="yt-pa-rem-grid">
                <div class="yt-pa-rem-item primary">
                  <span class="yt-pa-rem-k">Remaining</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-dur">--</span>
                </div>
                <div class="yt-pa-rem-item">
                  <span class="yt-pa-rem-k">Videos Left</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-count">--</span>
                </div>
                <div class="yt-pa-rem-item highlight">
                  <span class="yt-pa-rem-k">At 1.5×</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-15x">--</span>
                </div>
                <div class="yt-pa-rem-item">
                  <span class="yt-pa-rem-k">At 2×</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-2x">--</span>
                </div>
              </div>
            </div>
            <div class="yt-pa-divider"></div>
            <div class="yt-pa-section-heading" style="margin-bottom: 8px;">Total Playlist Stats</div>
            <div class="yt-pa-ov-list">
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Total duration</span>
                <span class="yt-pa-ov-val" id="yt-pa-total-dur">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Videos</span>
                <span class="yt-pa-ov-val" id="yt-pa-total-vids">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">Average length</span>
                <span class="yt-pa-ov-val" id="yt-pa-avg-dur">--</span>
              </div>
              <div class="yt-pa-ov-row">
                <span class="yt-pa-ov-label">At 2×</span>
                <span class="yt-pa-ov-val" id="yt-pa-2x-dur">--</span>
              </div>
            </div>
            <div class="yt-pa-divider"></div>
            <div class="yt-pa-ov-extremes">
              <div class="yt-pa-ov-ext-block">
                <div class="yt-pa-ov-ext-heading">Shortest</div>
                <div class="yt-pa-ov-ext-row" id="yt-pa-shortest">--</div>
              </div>
              <div class="yt-pa-ov-ext-block">
                <div class="yt-pa-ov-ext-heading">Longest</div>
                <div class="yt-pa-ov-ext-row" id="yt-pa-longest">--</div>
              </div>
            </div>
          </div>

          <!-- Speeds Tab -->
          <div class="yt-pa-tab-content" id="yt-pa-tc-speeds">
            <div class="yt-pa-speeds-list" id="yt-pa-speeds-list"></div>
            <div class="yt-pa-divider"></div>
            <div class="yt-pa-ts-section">
              <div class="yt-pa-section-heading">Time saved</div>
              <div id="yt-pa-time-saved-grid" class="yt-pa-ts-list"></div>
            </div>
          </div>

          <!-- Schedule Tab -->
          <div class="yt-pa-tab-content" id="yt-pa-tc-schedule">
            <div class="yt-pa-schedule-table" id="yt-pa-schedule-list"></div>
            <div class="yt-pa-divider"></div>
            <div class="yt-pa-custom-calc">
              <div class="yt-pa-section-heading">Custom calculator</div>
              <div class="yt-pa-cc-grid">
                <div class="yt-pa-cc-field" style="grid-column: span 2;">
                  <label class="yt-pa-field-label">Calculate for</label>
                  <select id="yt-pa-custom-scope" class="yt-pa-select">
                    <option value="remaining" selected>Remaining videos</option>
                    <option value="all">Entire playlist</option>
                  </select>
                </div>
                <div class="yt-pa-cc-field">
                  <label class="yt-pa-field-label">Watch time</label>
                  <select id="yt-pa-custom-hrs" class="yt-pa-select">
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
                <div class="yt-pa-cc-field">
                  <label class="yt-pa-field-label">Playback speed</label>
                  <select id="yt-pa-custom-spd" class="yt-pa-select">
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                    <option value="1.5" selected>1.5×</option>
                    <option value="1.75">1.75×</option>
                    <option value="2">2×</option>
                    <option value="3">3×</option>
                  </select>
                </div>
              </div>
              <div class="yt-pa-cc-result">
                <span>Result: You'll finish in </span><span id="yt-pa-custom-days" class="yt-pa-cc-days-val">--</span>
              </div>
            </div>
          </div>

          <!-- Videos Tab -->
          <div class="yt-pa-tab-content" id="yt-pa-tc-videos">
            <div class="yt-pa-videos-header">
              <input type="text" id="yt-pa-video-search" class="yt-pa-search-input" placeholder="Search videos...">
              <div class="yt-pa-sort-controls">
                <button class="yt-pa-sort-btn active" data-sort="index">Order</button>
                <button class="yt-pa-sort-btn" data-sort="duration-asc">Shortest</button>
                <button class="yt-pa-sort-btn" data-sort="duration-desc">Longest</button>
              </div>
            </div>
            <div id="yt-pa-videos-list" class="yt-pa-videos-list"></div>
          </div>
        </div>

        <!-- Video Mode -->
        <div class="yt-pa-video-results" id="yt-pa-video-results" style="display:none;">
          <div class="yt-pa-vid-meta">
            <div class="yt-pa-vid-title" id="yt-pa-vid-title">--</div>
            <div class="yt-pa-vid-channel" id="yt-pa-vid-channel"></div>
          </div>
          <div class="yt-pa-vid-progress-block">
            <div class="yt-pa-vid-progress-bar-bg">
              <div class="yt-pa-vid-progress-bar-fill" id="yt-pa-vid-progress-fill" style="width:0%"></div>
            </div>
            <div class="yt-pa-vid-time-row">
              <span id="yt-pa-vid-current">0:00</span>
              <span id="yt-pa-vid-total">0:00</span>
            </div>
          </div>
          <div class="yt-pa-vid-finish-row">
            <span class="yt-pa-vid-finish-label">Estimated finish</span>
            <span class="yt-pa-vid-finish-time" id="yt-pa-vid-end-clock">--:--</span>
            <span class="yt-pa-vid-finish-sub" id="yt-pa-vid-remain-text">--</span>
          </div>
          <div class="yt-pa-divider"></div>
          <div class="yt-pa-section-heading">Speed & finish time</div>
          <div class="yt-pa-vid-speeds-table" id="yt-pa-vid-speeds-table"></div>
          <div class="yt-pa-divider"></div>
          <div class="yt-pa-section-heading">Time saved</div>
          <div class="yt-pa-ts-list" id="yt-pa-vid-time-saved-grid"></div>
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

    // Mode toggle button (for watch page with playlist)
    const modeToggle = document.getElementById('yt-pa-mode-toggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', () => {
        if (activeWatchMode === 'playlist') {
          activeWatchMode = 'video';
        } else {
          activeWatchMode = 'playlist';
        }
        runAnalysis();
      });
    }

    // Custom calculator & remaining inputs
    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    if (fromVidSelect) {
      fromVidSelect.addEventListener('change', () => {
        updateInlineRemaining(fromVidSelect.value);
      });
    }
    const customScope = document.getElementById('yt-pa-custom-scope');
    if (customScope) customScope.addEventListener('change', updateCustomCalc);
    const customHrs = document.getElementById('yt-pa-custom-hrs');
    const customSpd = document.getElementById('yt-pa-custom-spd');
    if (customHrs) customHrs.addEventListener('change', updateCustomCalc);
    if (customSpd) customSpd.addEventListener('change', updateCustomCalc);

    // Video search & sort in Videos tab
    const vidSearch = document.getElementById('yt-pa-video-search');
    if (vidSearch) {
      vidSearch.addEventListener('input', (e) => {
        filterInlineVideos(e.target.value);
      });
    }

    panel.querySelectorAll('.yt-pa-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.yt-pa-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sortInlineVideos(btn.dataset.sort);
      });
    });
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
      stopVideoAnalyzer();
    }
  }

  let videoTimeUpdateHandler = null;
  let videoIntervalTimer = null;

  function stopVideoAnalyzer() {
    if (videoIntervalTimer) {
      clearInterval(videoIntervalTimer);
      videoIntervalTimer = null;
    }
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && videoTimeUpdateHandler) {
      video.removeEventListener('timeupdate', videoTimeUpdateHandler);
      videoTimeUpdateHandler = null;
    }
  }

  async function runAnalysis() {
    if (!isContextValid()) return;
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const results = document.getElementById('yt-pa-results');
    const videoResults = document.getElementById('yt-pa-video-results');
    const topNav = document.getElementById('yt-pa-top-nav');
    const headerTitle = document.getElementById('yt-pa-header-title');
    const modeToggle = document.getElementById('yt-pa-mode-toggle');

    loading.style.display = 'flex';
    noPlaylist.style.display = 'none';
    results.style.display = 'none';
    if (videoResults) videoResults.style.display = 'none';
    if (topNav) topNav.style.display = 'none';

    stopVideoAnalyzer();

    // Configure mode toggle button on /watch with playlist queue
    if (modeToggle) {
      if (isVideoWatchPage() && hasPlaylistParam()) {
        modeToggle.style.display = 'inline-block';
        modeToggle.textContent = (activeWatchMode === 'playlist') ? 'View Video ❯' : 'View Playlist ❯';
      } else {
        modeToggle.style.display = 'none';
      }
    }

    if (isPlaylistPage()) {
      if (headerTitle) headerTitle.textContent = 'Playlist Analyzer';
      await runPlaylistAnalysis();
    } else if (isVideoPage()) {
      if (headerTitle) headerTitle.textContent = 'Video Analyzer';
      runVideoAnalysis();
    } else {
      loading.style.display = 'none';
      noPlaylist.style.display = 'flex';
      noPlaylist.querySelector('p:first-of-type').textContent = 'No Media Found';
      noPlaylist.querySelector('p:last-of-type').textContent = 'Open any YouTube video or playlist to analyze.';
    }
  }

  async function runPlaylistAnalysis() {
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const results = document.getElementById('yt-pa-results');
    const topNav = document.getElementById('yt-pa-top-nav');

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

  function runVideoAnalysis() {
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const videoResults = document.getElementById('yt-pa-video-results');
    const results = document.getElementById('yt-pa-results');
    const topNav = document.getElementById('yt-pa-top-nav');

    if (results) results.style.display = 'none';
    if (topNav) topNav.style.display = 'none';

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) {
      loading.style.display = 'flex';
      noPlaylist.style.display = 'none';
      if (videoResults) videoResults.style.display = 'none';

      // Brief retry for SPA page transitions where video element takes a moment to mount
      setTimeout(() => {
        if (!panelOpen || !isVideoPage()) return;
        const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (v) {
          loading.style.display = 'none';
          if (videoResults) videoResults.style.display = 'block';
          initVideoAnalysisDOM();
          updateVideoAnalysisUI();
          startVideoInterval();
          v.addEventListener('loadedmetadata', updateVideoAnalysisUI, { once: true });
        } else {
          loading.style.display = 'none';
          noPlaylist.style.display = 'flex';
          noPlaylist.querySelector('p:first-of-type').textContent = 'No Video Playing';
          noPlaylist.querySelector('p:last-of-type').textContent = 'Please play a video on YouTube.';
        }
      }, 400);
      return;
    }

    loading.style.display = 'none';
    noPlaylist.style.display = 'none';
    videoResults.style.display = 'block';

    initVideoAnalysisDOM();
    updateVideoAnalysisUI();
    startVideoInterval();

    video.addEventListener('loadedmetadata', updateVideoAnalysisUI, { once: true });
  }

  function startVideoInterval() {
    stopVideoAnalyzer();
    videoIntervalTimer = setInterval(() => {
      if (panelOpen && isVideoPage()) {
        updateVideoAnalysisUI();
      } else {
        stopVideoAnalyzer();
      }
    }, 1000);
  }

  function initVideoAnalysisDOM() {
    const speedsTable = document.getElementById('yt-pa-vid-speeds-table');
    const tsGrid = document.getElementById('yt-pa-vid-time-saved-grid');
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
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetSpeed = parseFloat(row.dataset.speed);
          const vid = document.querySelector('video.html5-main-video') || document.querySelector('video');
          if (!isNaN(targetSpeed) && vid) {
            vid.playbackRate = targetSpeed;
            updateVideoAnalysisUI();
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

  function updateVideoAnalysisUI() {
    if (!isContextValid()) return;
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video || isNaN(video.duration) || video.duration <= 0) return;

    const meta = getVideoMeta();
    const titleEl = document.getElementById('yt-pa-vid-title');
    const channelEl = document.getElementById('yt-pa-vid-channel');
    if (titleEl && titleEl.textContent !== meta.title) titleEl.textContent = meta.title || 'YouTube Video';
    if (channelEl && channelEl.textContent !== meta.channel) channelEl.textContent = meta.channel;

    const currentTime = video.currentTime || 0;
    const duration = video.duration || 0;
    const currentSpeed = video.playbackRate || 1;
    const remainingSeconds = Math.max(0, duration - currentTime);
    const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

    // Progress bar and times
    const fillEl = document.getElementById('yt-pa-vid-progress-fill');
    if (fillEl) fillEl.style.width = `${progressPercent.toFixed(1)}%`;

    const currEl = document.getElementById('yt-pa-vid-current');
    const totEl = document.getElementById('yt-pa-vid-total');
    if (currEl) currEl.textContent = formatTime(Math.round(currentTime));
    if (totEl) totEl.textContent = formatTime(Math.round(duration));

    // Finish badge
    const adjustedRemaining = remainingSeconds / currentSpeed;
    const endDate = new Date(Date.now() + adjustedRemaining * 1000);
    const endClockStr = endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const clockEl = document.getElementById('yt-pa-vid-end-clock');
    const remainEl = document.getElementById('yt-pa-vid-remain-text');
    if (clockEl) clockEl.textContent = endClockStr;
    if (remainEl) remainEl.textContent = `${formatDuration(Math.round(adjustedRemaining))} left (${currentSpeed}×)`;

    // Update speeds table text only
    const speedsTable = document.getElementById('yt-pa-vid-speeds-table');
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

    // Update time saved grid text only
    const tsGrid = document.getElementById('yt-pa-vid-time-saved-grid');
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
      const title = s.title.length > 40 ? s.title.substring(0, 38) + '...' : s.title;
      document.getElementById('yt-pa-shortest').innerHTML = `
        <span class="yt-pa-ov-ext-title" title="${escapeHtml(s.title)}">${escapeHtml(title)}</span>
        <span class="yt-pa-ov-ext-time">${formatTime(s.durationSeconds)}</span>
      `;
    }
    if (analysisData.longest) {
      const l = analysisData.longest;
      const title = l.title.length > 40 ? l.title.substring(0, 38) + '...' : l.title;
      document.getElementById('yt-pa-longest').innerHTML = `
        <span class="yt-pa-ov-ext-title" title="${escapeHtml(l.title)}">${escapeHtml(title)}</span>
        <span class="yt-pa-ov-ext-time">${formatTime(l.durationSeconds)}</span>
      `;
    }

    // Speeds
    const speedsList = document.getElementById('yt-pa-speeds-list');
    speedsList.innerHTML = analysisData.speedAnalysis.map(item => {
      const pct = (item.totalSeconds / analysisData.totalSeconds) * 100;
      const rec = item.speed === 1.5;
      return `<div class="yt-pa-speed-row ${rec ? 'active' : ''}">
        <span class="yt-pa-speed-label">${item.speed}×</span>
        <div class="yt-pa-speed-bar-bg"><div class="yt-pa-speed-bar-fill" style="width:${pct}%"></div></div>
        <span class="yt-pa-speed-val">${item.formatted}</span>
      </div>`;
    }).join('');

    // Time saved
    const tsGrid = document.getElementById('yt-pa-time-saved-grid');
    tsGrid.innerHTML = [1.25, 1.5, 2, 3].map(sp => {
      const saved = analysisData.totalSeconds - Math.round(analysisData.totalSeconds / sp);
      return `<div class="yt-pa-ts-row">
        <span class="yt-pa-ts-label">At ${sp}×</span>
        <span class="yt-pa-ts-val">${formatDuration(saved)}</span>
      </div>`;
    }).join('');

    // Schedule
    const schedList = document.getElementById('yt-pa-schedule-list');
    schedList.innerHTML = `
      <div class="yt-pa-sched-header">
        <span class="yt-pa-sched-col-time">Watch time / day</span>
        <span class="yt-pa-sched-col">1×</span>
        <span class="yt-pa-sched-col yt-pa-sched-col-active">1.5×</span>
        <span class="yt-pa-sched-col">2×</span>
      </div>
      <div class="yt-pa-sched-body">
        ${analysisData.dailySchedules.map(s => `
          <div class="yt-pa-sched-row">
            <span class="yt-pa-sched-col-time">${s.label}</span>
            <span class="yt-pa-sched-col">${s.days}d</span>
            <span class="yt-pa-sched-col yt-pa-sched-col-active">${s.daysAt1_5x}d</span>
            <span class="yt-pa-sched-col">${s.daysAt2x}d</span>
          </div>
        `).join('')}
      </div>
    `;

    // Initialize remaining progress card with video dropdown
    const initialFromIdx = playlistData.currentVideoIndex || 1;
    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    if (fromVidSelect && playlistData.videos) {
      fromVidSelect.innerHTML = playlistData.videos.map(v => {
        const cleanTitle = (v.title || '').replace(/\s+/g, ' ').trim();
        const shortTitle = cleanTitle.length > 24 ? cleanTitle.substring(0, 22) + '…' : cleanTitle;
        const dur = v.durationFormatted ? ` (${v.durationFormatted})` : '';
        return `<option value="${v.index}">Video ${v.index}: ${escapeHtml(shortTitle)}${dur}</option>`;
      }).join('');
      fromVidSelect.value = initialFromIdx;
    }
    updateInlineRemaining(initialFromIdx);
    renderInlineVideoList();

    updateCustomCalc();
  }

  function updateInlineRemaining(fromIdx) {
    if (!playlistData || !playlistData.videos || playlistData.videos.length === 0) return;
    const total = playlistData.videos.length;
    fromIdx = Math.max(1, Math.min(parseInt(fromIdx, 10) || 1, total));

    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    if (fromVidSelect && parseInt(fromVidSelect.value, 10) !== fromIdx) {
      fromVidSelect.value = fromIdx;
    }

    const remVideos = playlistData.videos.slice(fromIdx - 1);
    const remSeconds = remVideos.reduce((sum, v) => sum + v.durationSeconds, 0);

    const badge = document.getElementById('yt-pa-rem-badge');
    if (badge) {
      badge.textContent = fromIdx > 1 ? `Now at Video ${fromIdx}` : `Full Playlist (${total} vids)`;
    }

    const durEl = document.getElementById('yt-pa-rem-dur');
    if (durEl) durEl.textContent = formatDuration(remSeconds);

    const countEl = document.getElementById('yt-pa-rem-count');
    if (countEl) countEl.textContent = `${remVideos.length} vids left`;

    const at15xEl = document.getElementById('yt-pa-rem-15x');
    if (at15xEl) at15xEl.textContent = formatDuration(Math.round(remSeconds / 1.5));

    const at2xEl = document.getElementById('yt-pa-rem-2x');
    if (at2xEl) at2xEl.textContent = formatDuration(Math.round(remSeconds / 2));

    highlightInlineCurrentVideo(fromIdx);
    updateCustomCalc();
  }

  function updateCustomCalc() {
    if (!analysisData || !playlistData) return;
    const hrs = parseFloat(document.getElementById('yt-pa-custom-hrs')?.value) || 1;
    const spd = parseFloat(document.getElementById('yt-pa-custom-spd')?.value) || 1;
    const scope = document.getElementById('yt-pa-custom-scope')?.value || 'remaining';

    let targetSeconds = analysisData.totalSeconds;
    if (scope === 'remaining') {
      const fromIdx = Math.max(1, Math.min(parseInt(document.getElementById('yt-pa-from-vid-select')?.value, 10) || 1, playlistData.videos.length));
      const remVideos = playlistData.videos.slice(fromIdx - 1);
      targetSeconds = remVideos.reduce((sum, v) => sum + v.durationSeconds, 0);
    }

    const days = Math.ceil((targetSeconds / spd) / (hrs * 3600));
    const el = document.getElementById('yt-pa-custom-days');
    if (el) el.textContent = `${days} day${days > 1 ? 's' : ''}`;
  }

  function renderInlineVideoList(videos = null) {
    const container = document.getElementById('yt-pa-videos-list');
    if (!container || !playlistData || !playlistData.videos) return;

    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    const currentFromIndex = fromVidSelect ? (parseInt(fromVidSelect.value, 10) || 1) : (playlistData.currentVideoIndex || 1);

    const videoData = videos || playlistData.videos;

    container.innerHTML = videoData.map(video => {
      const idx = video.index || 0;
      const isCurrent = idx === currentFromIndex;
      const isWatched = idx < currentFromIndex;
      return `
        <div class="yt-pa-video-item ${video.isUnavailable ? 'unavailable' : ''} ${isCurrent ? 'current-video' : ''} ${isWatched ? 'watched-video' : ''}" 
             data-url="${video.url || ''}" 
             data-index="${video.index || ''}"
             data-duration="${video.durationSeconds || 0}"
             title="${escapeHtml(video.title || '')}">
          <span class="yt-pa-vid-item-index">${video.index || ''}</span>
          <span class="yt-pa-vid-item-title">${escapeHtml(video.title || 'Untitled')}</span>
          <span class="yt-pa-vid-item-duration">${video.durationFormatted || '--'}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.yt-pa-video-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        if (fromVidSelect && !isNaN(idx)) {
          fromVidSelect.value = idx;
          updateInlineRemaining(idx);
        }
        const url = item.dataset.url;
        if (url) {
          window.location.href = url;
        }
      });
    });
  }

  function highlightInlineCurrentVideo(fromIdx) {
    const container = document.getElementById('yt-pa-videos-list');
    if (!container) return;
    container.querySelectorAll('.yt-pa-video-item').forEach(item => {
      const idx = parseInt(item.dataset.index, 10);
      item.classList.toggle('current-video', idx === fromIdx);
      item.classList.toggle('watched-video', idx < fromIdx);
    });
  }

  function filterInlineVideos(query) {
    if (!playlistData || !playlistData.videos) return;
    const filtered = query
      ? playlistData.videos.filter(v =>
          (v.title || '').toLowerCase().includes(query.toLowerCase()))
      : playlistData.videos;
    renderInlineVideoList(filtered);
  }

  function sortInlineVideos(sortType) {
    if (!playlistData || !playlistData.videos) return;
    let sorted = [...playlistData.videos];

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

    renderInlineVideoList(sorted);
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
    let lastTrackedUrl = window.location.href;

    function handleLocationChange() {
      if (!isContextValid()) return;
      const currentUrl = window.location.href;
      if (currentUrl === lastTrackedUrl) return;
      lastTrackedUrl = currentUrl;

      // Reset active mode selection and stale cache
      activeWatchMode = null;
      playlistData = null;
      analysisData = null;
      stopVideoAnalyzer();

      // Ensure floating button exists
      setTimeout(() => {
        if (!isContextValid()) return;
        if (!document.getElementById('yt-playlist-analyzer-btn')) {
          injectFloatingButton();
        }
      }, 250);

      // LIVE UPDATION:
      // If panel is currently open, immediately re-run analysis for the new page without requiring a reload!
      if (panelOpen) {
        runAnalysis();
      }
    }

    // Native YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', handleLocationChange);
    document.addEventListener('yt-navigate-finish', handleLocationChange);
    window.addEventListener('yt-page-data-updated', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);

    // Backup lightweight URL check every 500ms
    setInterval(() => {
      if (!isContextValid()) return;
      if (window.location.href !== lastTrackedUrl) {
        handleLocationChange();
      }
    }, 500);
  }

  // Watch for fullscreen mode (hide button and close panel during fullscreen video)
  function setupFullscreenWatcher() {
    function onFullscreenChange() {
      if (!isContextValid()) return;
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const btn = document.getElementById('yt-playlist-analyzer-btn');
      const panel = document.getElementById('yt-pa-panel');

      if (isFullscreen) {
        if (btn) btn.classList.add('yt-pa-hidden');
        if (panel) panel.classList.add('yt-pa-hidden');
        if (panelOpen) {
          togglePanel();
        }
      } else {
        if (btn) btn.classList.remove('yt-pa-hidden');
        if (panel) panel.classList.remove('yt-pa-hidden');
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  // Initialize
  injectFloatingButton();
  watchNavigation();
  setupFullscreenWatcher();
})();
