// Content script - runs on YouTube pages
// Extracts playlist data from the YouTube DOM and renders the in-page panel.
// Depends on lib/core.js (loaded first via manifest.json) for the YTPA helpers.

(function() {
  'use strict';

  if (!globalThis.YTPA) return;
  const {
    SPEEDS, TIME_SAVED_SPEEDS, DEFAULT_SETTINGS,
    parseDuration, formatTime, formatDuration, escapeHtml,
    daysToFinish, formatDays, videoIdFromUrl, analyzePlaylist,
    clampIndex, computeRemaining, getVisibleVideos, cardSpeed
  } = globalThis.YTPA;

  const VIDEO_SELECTOR = 'video.html5-main-video';
  const PLAYLIST_ITEM_SELECTOR = 'ytd-playlist-video-renderer';
  const PANEL_ITEM_SELECTOR = 'ytd-playlist-panel-video-renderer';
  const ITEM_LINK_SELECTOR = 'a#wc-endpoint, a#video-title, a#thumbnail, a[href*="/watch?"]';

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

  function getMainVideo() {
    return document.querySelector(VIDEO_SELECTOR) || document.querySelector('video');
  }

  function isAdPlaying() {
    return !!document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing');
  }

  // ===== SETTINGS =====

  let settings = { ...DEFAULT_SETTINGS };

  function loadSettings() {
    if (!isContextValid()) return;
    globalThis.YTPA.loadSettings().then(s => {
      settings = s;
      applySettings();
    });
  }

  function applySettings() {
    const btn = document.getElementById('yt-playlist-analyzer-btn');
    if (btn) btn.classList.toggle('yt-pa-off', !settings.showFloatingBtn);
    if (!settings.showFloatingBtn && panelOpen) togglePanel();

    const spdSelect = document.getElementById('yt-pa-custom-spd');
    if (spdSelect && !spdSelect.dataset.userChanged) {
      spdSelect.value = String(parseFloat(settings.defaultSpeed) || 1.5);
      if (!spdSelect.value) spdSelect.value = '1.5';
    }
    if (analysisData) renderInlineResults();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings || !isContextValid()) return;
      settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      applySettings();
    });
  } catch (e) { /* context gone */ }

  // ===== MESSAGES FROM POPUP =====

  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isContextValid()) return;

      if (message.type === 'EXTRACT_PLAYLIST_DATA') {
        extractPlaylistData(() => !isContextValid())
          .then(data => sendResponse({ success: true, data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }

      if (message.type === 'GET_VIDEO_DATA') {
        try {
          const video = getMainVideo();
          if (!video) {
            sendResponse({ success: false, error: 'No video element found on page' });
            return false;
          }
          const meta = getVideoMeta();
          const params = new URLSearchParams(window.location.search);
          sendResponse({
            success: true,
            data: {
              title: meta.title || 'YouTube Video',
              channel: meta.channel || '',
              currentTime: video.currentTime || 0,
              duration: video.duration || 0,
              playbackRate: video.playbackRate || 1,
              isPaused: video.paused,
              isAd: isAdPlaying(),
              videoId: params.get('v'),
              playlistId: params.get('list')
            }
          });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        return false;
      }

      if (message.type === 'OPEN_VIDEO') {
        let ok = false;
        try {
          const target = new URL(message.url, window.location.origin);
          if (target.hostname === 'www.youtube.com') {
            ok = navigateToVideoUrl(target.href, message.index);
          }
        } catch (e) { ok = false; }
        sendResponse({ success: ok });
        return false;
      }

      if (message.type === 'SET_PLAYBACK_SPEED') {
        try {
          const video = getMainVideo();
          if (video && typeof message.speed === 'number') {
            video.playbackRate = message.speed;
            sendResponse({ success: true, playbackRate: video.playbackRate });
          } else {
            sendResponse({ success: false, error: 'Video not found or invalid speed' });
          }
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        return false;
      }
    });
  }

  // ===== PAGE DETECTION =====

  let activeWatchMode = null; // 'video' | 'playlist' | null

  function isDedicatedPlaylistPage() {
    return window.location.pathname === '/playlist';
  }

  function isVideoWatchPage() {
    const path = window.location.pathname;
    return path === '/watch' || path.startsWith('/shorts/');
  }

  function getPlaylistId() {
    return new URLSearchParams(window.location.search).get('list');
  }

  function hasPlaylistParam() {
    return !!getPlaylistId();
  }

  function isPlaylistPage() {
    if (isDedicatedPlaylistPage()) return true;
    if (isVideoWatchPage()) {
      return activeWatchMode === 'playlist' && hasPlaylistParam();
    }
    return hasPlaylistParam();
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

  // ===== EXTRACTION =====

  function getPlaylistPageExpectedCount() {
    const statsEl = document.querySelector(
      '.ytd-playlist-header-renderer .metadata-stats yt-formatted-string, ' +
      '#stats yt-formatted-string, ' +
      '.ytd-playlist-sidebar-primary-info-renderer .stats yt-formatted-string'
    );
    if (!statsEl) return 0;
    const match = statsEl.textContent.match(/(\d[\d,]*)/);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
  }

  async function extractPlaylistData(isCancelled = () => false) {
    const playlistId = getPlaylistId();
    if (!playlistId) {
      throw new Error('No playlist found on this page. Navigate to a YouTube playlist first.');
    }

    await waitForElement(`${PLAYLIST_ITEM_SELECTOR}, ${PANEL_ITEM_SELECTOR}`);

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

    if (isDedicatedPlaylistPage()) {
      await scrollToLoadAllVideos(isCancelled);
    } else {
      await scrollToLoadAllWatchPlaylistVideos(isCancelled);
    }

    const videos = extractVideoItems();

    if (videos.length === 0) {
      throw new Error('Could not extract video data. Make sure you are on a playlist page with visible videos.');
    }

    let totalVideoCount = isDedicatedPlaylistPage()
      ? getPlaylistPageExpectedCount()
      : getWatchPlaylistExpectedCount();
    if (!totalVideoCount || videos.length > totalVideoCount) {
      totalVideoCount = videos.length;
    }

    return {
      playlistId,
      playlistTitle,
      channelName,
      playlistUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      totalVideoCount,
      loadedVideoCount: videos.length,
      currentVideoIndex: getCurrentVideoIndex(videos),
      videos
    };
  }

  // 1-based index of the video currently open in this tab, within `videos`.
  // Returns 0 when the current page is not a video from this list.
  function getPlayingIndex(videos) {
    if (!isVideoWatchPage() || !videos || videos.length === 0) return 0;
    const params = new URLSearchParams(window.location.search);

    // 1. Match by video ID (most reliable)
    const currentVideoId = params.get('v');
    if (currentVideoId) {
      const matchIndex = videos.findIndex(v => videoIdFromUrl(v.url) === currentVideoId);
      if (matchIndex !== -1) return matchIndex + 1;
    }

    // 2. URL &index= parameter
    const urlIndex = parseInt(params.get('index'), 10);
    if (!isNaN(urlIndex) && urlIndex >= 1 && urlIndex <= videos.length) {
      return urlIndex;
    }

    // 3. DOM selected queue item
    const selIdx = videos.findIndex(v => v.isSelected);
    return selIdx !== -1 ? selIdx + 1 : 0;
  }

  function getCurrentVideoIndex(videos) {
    return getPlayingIndex(videos) || 1;
  }

  function getItemElements() {
    let els = document.querySelectorAll(PLAYLIST_ITEM_SELECTOR);
    if (els.length === 0) els = document.querySelectorAll(PANEL_ITEM_SELECTOR);
    return els;
  }

  function extractVideoItems() {
    const videos = [];

    getItemElements().forEach((el, index) => {
      const titleEl = el.querySelector('#video-title');
      const title = titleEl ? titleEl.textContent.trim() : `Video ${index + 1}`;

      let durationSeconds = 0;
      const durationEl = el.querySelector(
        'ytd-thumbnail-overlay-time-status-renderer #text, ' +
        'span.ytd-thumbnail-overlay-time-status-renderer, ' +
        '.badge-shape-wiz__text, ' +
        '.yt-badge-shape__text'
      );
      if (durationEl) {
        durationSeconds = parseDuration(durationEl.textContent);
      }

      let videoChannel = '';
      const vidChannelEl = el.querySelector('#channel-name yt-formatted-string a, .ytd-channel-name a, #byline');
      if (vidChannelEl) {
        videoChannel = vidChannelEl.textContent.trim();
      }

      let videoUrl = '';
      const linkEl = el.querySelector(ITEM_LINK_SELECTOR);
      if (linkEl && linkEl.href) {
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
        durationFormatted: durationSeconds > 0 ? formatTime(durationSeconds) : '',
        channel: videoChannel,
        url: videoUrl,
        isUnavailable,
        isSelected
      });
    });

    return videos;
  }

  // Reads the "Channel - 8 / 75" counter from the watch-page playlist header.
  // Video titles inside the list are skipped so "Part 1 of 5" can't be mistaken for the total.
  function getWatchPlaylistExpectedCount() {
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    if (!panel) return 0;

    const candidates = panel.querySelectorAll(
      '#header-description, .publisher-container, #publisher-container, ' +
      '#header-contents, yt-formatted-string, #index, span'
    );

    for (const el of candidates) {
      if (el.closest(`#items, ${PANEL_ITEM_SELECTOR}`)) continue;
      const text = el.textContent || '';
      const match = text.match(/(?:\/|\bof\b)\s*(\d[\d,]*)/i);
      if (match) {
        const count = parseInt(match[1].replace(/,/g, ''), 10);
        if (!isNaN(count) && count > 0) {
          return count;
        }
      }
    }
    return 0;
  }

  function setLoadingText(text) {
    const loadingText = document.getElementById('yt-pa-loading-text');
    if (loadingText) loadingText.textContent = text;
  }

  async function scrollToLoadAllWatchPlaylistVideos(isCancelled) {
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    if (!panel) return;

    const expectedTotal = getWatchPlaylistExpectedCount();
    const countItems = () => panel.querySelectorAll(PANEL_ITEM_SELECTOR).length;

    let previousCount = countItems();
    if (expectedTotal > 0 && previousCount >= expectedTotal) return;

    const itemsContainer = panel.querySelector('#items') ||
                           panel.querySelector('.playlist-items') ||
                           panel.querySelector('#container') ||
                           panel;

    // Remember where the user was so we can put everything back afterwards
    const savedWindowY = window.scrollY;
    const savedItemsScroll = itemsContainer.scrollTop;

    const maxAttempts = 60;
    let sameCountStreak = 0;

    try {
      for (let i = 0; i < maxAttempts; i++) {
        if (isCancelled()) return;

        if (typeof itemsContainer.scrollTop === 'number') {
          itemsContainer.scrollTop = itemsContainer.scrollHeight;
        }

        const continuation = panel.querySelector('ytd-continuation-item-renderer');
        const lastVideo = panel.querySelector(`${PANEL_ITEM_SELECTOR}:last-of-type`);
        const target = continuation || lastVideo;
        if (target) target.scrollIntoView({ behavior: 'instant', block: 'end' });

        await sleep(500);
        if (isCancelled()) return;

        const currentCount = countItems();
        if (expectedTotal > 0) {
          setLoadingText(`Loading playlist (${currentCount}/${expectedTotal})...`);
          if (currentCount >= expectedTotal) break;
        }

        if (currentCount === previousCount) {
          sameCountStreak++;
          if (sameCountStreak >= 3) {
            if (!panel.querySelector('ytd-continuation-item-renderer')) break;
            await sleep(600);
            if (sameCountStreak >= 4) break;
          }
        } else {
          sameCountStreak = 0;
        }

        previousCount = currentCount;
      }
    } finally {
      itemsContainer.scrollTop = savedItemsScroll;
      window.scrollTo(window.scrollX, savedWindowY);
    }
  }

  async function scrollToLoadAllVideos(isCancelled) {
    const expectedTotal = getPlaylistPageExpectedCount();
    const countItems = () => document.querySelectorAll(PLAYLIST_ITEM_SELECTOR).length;

    let lastCount = countItems();
    if (expectedTotal > 0 && lastCount >= expectedTotal) return;

    const savedWindowY = window.scrollY;
    const maxScrollAttempts = 100;
    let sameCountStreak = 0;

    try {
      for (let i = 0; i < maxScrollAttempts; i++) {
        if (isCancelled()) return;

        window.scrollTo(0, document.documentElement.scrollHeight);
        const continuation = document.querySelector('ytd-continuation-item-renderer');
        const lastVideo = document.querySelector(`${PLAYLIST_ITEM_SELECTOR}:last-of-type`);
        const target = continuation || lastVideo;
        if (target) target.scrollIntoView({ behavior: 'instant', block: 'end' });

        await sleep(500);
        if (isCancelled()) return;

        const currentCount = countItems();
        if (expectedTotal > 0) {
          setLoadingText(`Loading playlist (${currentCount}/${expectedTotal})...`);
          if (currentCount >= expectedTotal) break;
        }

        if (currentCount === lastCount) {
          sameCountStreak++;
          if (sameCountStreak >= 3) {
            if (!document.querySelector('ytd-continuation-item-renderer')) break;
            await sleep(600);
            if (sameCountStreak >= 4) break;
          }
        } else {
          sameCountStreak = 0;
        }
        lastCount = currentCount;
      }
    } finally {
      window.scrollTo(0, savedWindowY);
    }
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
  let analysisData = null;
  let playlistData = null;
  let runId = 0;                 // bumps on every new analysis; stale runs bail out
  let listView = { query: '', sort: 'index' };
  let followPlaying = true;      // "From" follows the playing video until the user picks another one
  let playlistLiveTimer = null;
  let videoIntervalTimer = null;

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
          <p id="yt-pa-loading-text">Analyzing playlist...</p>
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
                  <span class="yt-pa-rem-k" id="yt-pa-rem-card-label">At 1.5×</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-15x">--</span>
                </div>
                <div class="yt-pa-rem-item">
                  <span class="yt-pa-rem-k">At 2×</span>
                  <span class="yt-pa-rem-v" id="yt-pa-rem-2x">--</span>
                </div>
              </div>
              <div class="yt-pa-rem-live-row" id="yt-pa-rem-live-row" style="display:none;">
                <span>Finish at current speed</span>
                <span id="yt-pa-rem-live-finish">--</span>
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
                <button class="yt-pa-sort-btn" data-sort="title-asc" title="Sort by title A to Z">A–Z</button>
                <button class="yt-pa-sort-btn" data-sort="title-desc" title="Sort by title Z to A">Z–A</button>
              </div>
              <div class="yt-pa-videos-hint" id="yt-pa-videos-hint">Click a video to play it</div>
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
    document.getElementById('yt-pa-mode-toggle').addEventListener('click', () => {
      activeWatchMode = (activeWatchMode === 'playlist') ? 'video' : 'playlist';
      runAnalysis();
    });

    // "From" dropdown: following the playing video stays on until the user picks another one
    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    fromVidSelect.addEventListener('change', () => {
      const picked = parseInt(fromVidSelect.value, 10);
      followPlaying = !!playlistData && picked === getPlayingIndex(playlistData.videos);
      updateInlineRemaining();
      highlightInlineCurrentVideo();
    });

    document.getElementById('yt-pa-custom-scope').addEventListener('change', updateCustomCalc);
    document.getElementById('yt-pa-custom-hrs').addEventListener('change', updateCustomCalc);
    const customSpd = document.getElementById('yt-pa-custom-spd');
    customSpd.value = String(parseFloat(settings.defaultSpeed) || 1.5);
    if (!customSpd.value) customSpd.value = '1.5';
    customSpd.addEventListener('change', () => {
      customSpd.dataset.userChanged = '1';
      updateCustomCalc();
    });

    // Video search & sort in Videos tab (they combine)
    document.getElementById('yt-pa-video-search').addEventListener('input', (e) => {
      listView.query = e.target.value;
      renderInlineVideoList();
    });

    panel.querySelectorAll('.yt-pa-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.yt-pa-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        listView.sort = btn.dataset.sort;
        renderInlineVideoList();
      });
    });

    // One delegated click handler for the video list
    document.getElementById('yt-pa-videos-list').addEventListener('click', onVideoListClick);
  }

  function resetListView() {
    listView = { query: '', sort: 'index' };
    const search = document.getElementById('yt-pa-video-search');
    if (search) search.value = '';
    document.querySelectorAll('#yt-pa-panel .yt-pa-sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === 'index');
    });
  }

  function togglePanel() {
    if (!isContextValid()) return;
    panelOpen = !panelOpen;
    const btn = document.getElementById('yt-playlist-analyzer-btn');

    if (panelOpen) {
      createPanel();
      const p = document.getElementById('yt-pa-panel');
      if (p) p.classList.add('open');
      if (btn) btn.classList.add('active');
      runAnalysis();
    } else {
      runId++; // cancel any in-flight playlist scroll
      const panel = document.getElementById('yt-pa-panel');
      if (panel) panel.classList.remove('open');
      if (btn) btn.classList.remove('active');
      stopVideoAnalyzer();
      stopPlaylistLive();
    }
  }

  function stopVideoAnalyzer() {
    if (videoIntervalTimer) {
      clearInterval(videoIntervalTimer);
      videoIntervalTimer = null;
    }
  }

  function stopPlaylistLive() {
    if (playlistLiveTimer) {
      clearInterval(playlistLiveTimer);
      playlistLiveTimer = null;
    }
  }

  function showNoMedia(title, sub) {
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    if (loading) loading.style.display = 'none';
    if (!noPlaylist) return;
    noPlaylist.style.display = 'flex';
    noPlaylist.querySelector('p:first-of-type').textContent = title;
    noPlaylist.querySelector('p:last-of-type').textContent = sub;
  }

  async function runAnalysis() {
    if (!isContextValid()) return;
    const myRun = ++runId;
    const isStale = () => myRun !== runId || !isContextValid() || !panelOpen;

    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const results = document.getElementById('yt-pa-results');
    const videoResults = document.getElementById('yt-pa-video-results');
    const topNav = document.getElementById('yt-pa-top-nav');
    const headerTitle = document.getElementById('yt-pa-header-title');
    if (!loading) return;

    loading.style.display = 'flex';
    setLoadingText('Analyzing playlist...');
    noPlaylist.style.display = 'none';
    results.style.display = 'none';
    if (videoResults) videoResults.style.display = 'none';
    if (topNav) topNav.style.display = 'none';

    stopVideoAnalyzer();
    stopPlaylistLive();

    updateModeToggle();

    if (isPlaylistPage()) {
      if (headerTitle) headerTitle.textContent = 'Playlist Analyzer';
      await runPlaylistAnalysis(isStale);
    } else if (isVideoPage()) {
      if (headerTitle) headerTitle.textContent = 'Video Analyzer';
      runVideoAnalysis();
    } else {
      showNoMedia('No Media Found', 'Open any YouTube video or playlist to analyze.');
    }
  }

  // "View Video / View Playlist" switch, only on /watch pages that have a playlist queue
  function updateModeToggle() {
    const modeToggle = document.getElementById('yt-pa-mode-toggle');
    if (!modeToggle) return;
    if (isVideoWatchPage() && hasPlaylistParam()) {
      modeToggle.style.display = 'inline-block';
      modeToggle.textContent = (activeWatchMode === 'playlist') ? 'View Video ❯' : 'View Playlist ❯';
    } else {
      modeToggle.style.display = 'none';
    }
  }

  function canReuseCachedPlaylist() {
    return !!(playlistData && analysisData &&
      playlistData.playlistId === getPlaylistId() &&
      playlistData.loadedVideoCount >= playlistData.totalVideoCount);
  }

  async function runPlaylistAnalysis(isStale) {
    const loading = document.getElementById('yt-pa-loading');
    const results = document.getElementById('yt-pa-results');
    const topNav = document.getElementById('yt-pa-top-nav');

    try {
      if (!canReuseCachedPlaylist()) {
        const data = await extractPlaylistData(isStale);
        if (isStale()) return; // user navigated / closed the panel meanwhile

        if (!data.videos || data.videos.length === 0) {
          showNoMedia('No Playlist Found', 'Open any YouTube playlist or video to analyze.');
          return;
        }

        playlistData = data;
        analysisData = analyzePlaylist(data.videos);
        followPlaying = true;
        resetListView();
        saveHistory();
      }

      renderInlineResults();
      loading.style.display = 'none';
      if (topNav) topNav.style.display = 'block';
      results.style.display = 'block';
      startPlaylistLive();

    } catch (err) {
      if (isStale()) return;
      showNoMedia('Error', err.message);
    }
  }

  function saveHistory() {
    if (!settings.saveHistory || !playlistData || !analysisData || !isContextValid()) return;
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_HISTORY',
        data: {
          playlistTitle: playlistData.playlistTitle,
          playlistUrl: playlistData.playlistUrl,
          totalVideos: analysisData.totalVideos,
          totalDuration: analysisData.totalDuration,
          totalSeconds: analysisData.totalSeconds
        }
      }).catch(() => {});
    } catch (e) { /* context gone */ }
  }

  function runVideoAnalysis() {
    const loading = document.getElementById('yt-pa-loading');
    const noPlaylist = document.getElementById('yt-pa-no-playlist');
    const videoResults = document.getElementById('yt-pa-video-results');

    const show = () => {
      loading.style.display = 'none';
      noPlaylist.style.display = 'none';
      videoResults.style.display = 'block';
      initVideoAnalysisDOM();
      updateVideoAnalysisUI();
      startVideoInterval();
      const v = getMainVideo();
      if (v) v.addEventListener('loadedmetadata', updateVideoAnalysisUI, { once: true });
    };

    if (getMainVideo()) {
      show();
      return;
    }

    // Brief retry for SPA page transitions where video element takes a moment to mount
    const myRun = runId;
    setTimeout(() => {
      if (!panelOpen || !isVideoPage() || myRun !== runId) return;
      if (getMainVideo()) {
        show();
      } else {
        showNoMedia('No Video Playing', 'Please play a video on YouTube.');
      }
    }, 400);
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
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetSpeed = parseFloat(row.dataset.speed);
          const vid = getMainVideo();
          if (!isNaN(targetSpeed) && vid) {
            vid.playbackRate = targetSpeed;
            updateVideoAnalysisUI();
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

  function updateVideoAnalysisUI() {
    if (!isContextValid()) return;
    const video = getMainVideo();
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

    const fillEl = document.getElementById('yt-pa-vid-progress-fill');
    if (fillEl) fillEl.style.width = `${progressPercent.toFixed(1)}%`;

    const currEl = document.getElementById('yt-pa-vid-current');
    const totEl = document.getElementById('yt-pa-vid-total');
    if (currEl) currEl.textContent = formatTime(currentTime);
    if (totEl) totEl.textContent = formatTime(duration);

    const adjustedRemaining = remainingSeconds / currentSpeed;
    const clockEl = document.getElementById('yt-pa-vid-end-clock');
    const remainEl = document.getElementById('yt-pa-vid-remain-text');
    if (clockEl) clockEl.textContent = clockAfter(adjustedRemaining);
    if (remainEl) remainEl.textContent = `${formatDuration(adjustedRemaining)} left (${currentSpeed}×)`;

    const speedsTable = document.getElementById('yt-pa-vid-speeds-table');
    if (speedsTable) {
      speedsTable.querySelectorAll('.yt-pa-vid-speed-row').forEach(row => {
        const sp = parseFloat(row.dataset.speed);
        if (isNaN(sp)) return;
        const spRemaining = Math.max(0, remainingSeconds / sp);
        const isCurrent = Math.abs(currentSpeed - sp) < 0.05;

        row.classList.toggle('active', isCurrent);

        const timeEl = row.querySelector('.yt-pa-vid-speed-time');
        if (timeEl) timeEl.textContent = `${formatDuration(spRemaining)} left`;

        const finishEl = row.querySelector('.yt-pa-vid-speed-finish');
        if (finishEl) finishEl.textContent = `Ends at ${clockAfter(spRemaining)}`;

        const btnEl = row.querySelector('.yt-pa-vid-set-speed-btn');
        if (btnEl) {
          btnEl.classList.toggle('active', isCurrent);
          btnEl.textContent = isCurrent ? 'Active' : `Set ${sp}×`;
        }
      });
    }

    const tsGrid = document.getElementById('yt-pa-vid-time-saved-grid');
    if (tsGrid) {
      tsGrid.querySelectorAll('.yt-pa-ts-row').forEach(item => {
        const sp = parseFloat(item.dataset.speed);
        if (isNaN(sp)) return;
        const saved = Math.max(0, remainingSeconds - remainingSeconds / sp);
        const valEl = item.querySelector('.yt-pa-ts-val');
        if (valEl) valEl.textContent = formatDuration(saved);
      });
    }
  }

  function extremeHtml(v) {
    const title = v.title.length > 40 ? v.title.substring(0, 38) + '...' : v.title;
    return `
      <span class="yt-pa-ov-ext-title" title="${escapeHtml(v.title)}">${escapeHtml(title)}</span>
      <span class="yt-pa-ov-ext-time">${formatTime(v.durationSeconds)}</span>
    `;
  }

  function renderInlineResults() {
    if (!analysisData || !playlistData) return;
    const a = analysisData;

    document.getElementById('yt-pa-playlist-name').textContent = playlistData.playlistTitle;
    document.getElementById('yt-pa-total-dur').textContent = a.totalDuration;
    document.getElementById('yt-pa-avg-dur').textContent = a.averageDuration;

    let videosText = String(a.totalVideos);
    if (playlistData.totalVideoCount > playlistData.loadedVideoCount) {
      videosText = `${playlistData.loadedVideoCount} of ${playlistData.totalVideoCount} loaded`;
    } else if (a.untimedVideos > 0) {
      videosText = `${a.totalVideos} (${a.untimedVideos} unavailable)`;
    }
    document.getElementById('yt-pa-total-vids').textContent = videosText;

    const at2x = a.speedAnalysis.find(s => s.speed === 2);
    document.getElementById('yt-pa-2x-dur').textContent = at2x ? at2x.formatted : '--';

    document.getElementById('yt-pa-shortest').innerHTML = a.shortest ? extremeHtml(a.shortest) : '--';
    document.getElementById('yt-pa-longest').innerHTML = a.longest ? extremeHtml(a.longest) : '--';

    // Speeds (highlight the user's default speed)
    const preferred = parseFloat(settings.defaultSpeed) || 1.5;
    document.getElementById('yt-pa-speeds-list').innerHTML = a.speedAnalysis.map(item => {
      const pct = a.totalSeconds > 0 ? (item.totalSeconds / a.totalSeconds) * 100 : 0;
      return `<div class="yt-pa-speed-row ${item.speed === preferred ? 'active' : ''}">
        <span class="yt-pa-speed-label">${item.speed}×</span>
        <div class="yt-pa-speed-bar-bg"><div class="yt-pa-speed-bar-fill" style="width:${pct}%"></div></div>
        <span class="yt-pa-speed-val">${item.formatted}</span>
      </div>`;
    }).join('');

    document.getElementById('yt-pa-time-saved-grid').innerHTML = TIME_SAVED_SPEEDS.map(sp => {
      const saved = a.totalSeconds - Math.round(a.totalSeconds / sp);
      return `<div class="yt-pa-ts-row">
        <span class="yt-pa-ts-label">At ${sp}×</span>
        <span class="yt-pa-ts-val">${formatDuration(saved)}</span>
      </div>`;
    }).join('');

    // Schedule
    document.getElementById('yt-pa-schedule-list').innerHTML = `
      <div class="yt-pa-sched-header">
        <span class="yt-pa-sched-col-time">Watch time / day</span>
        <span class="yt-pa-sched-col">1×</span>
        <span class="yt-pa-sched-col yt-pa-sched-col-active">1.5×</span>
        <span class="yt-pa-sched-col">2×</span>
      </div>
      <div class="yt-pa-sched-body">
        ${a.dailySchedules.map(s => `
          <div class="yt-pa-sched-row">
            <span class="yt-pa-sched-col-time">${s.label}</span>
            <span class="yt-pa-sched-col">${s.days}d</span>
            <span class="yt-pa-sched-col yt-pa-sched-col-active">${s.daysAt1_5x}d</span>
            <span class="yt-pa-sched-col">${s.daysAt2x}d</span>
          </div>
        `).join('')}
      </div>
    `;

    // "From" dropdown
    const fromVidSelect = document.getElementById('yt-pa-from-vid-select');
    const previousFrom = parseInt(fromVidSelect.value, 10);
    fromVidSelect.innerHTML = playlistData.videos.map(v => {
      const cleanTitle = (v.title || '').replace(/\s+/g, ' ').trim();
      const shortTitle = cleanTitle.length > 24 ? cleanTitle.substring(0, 22) + '…' : cleanTitle;
      const dur = v.durationFormatted ? ` (${v.durationFormatted})` : '';
      return `<option value="${v.index}">Video ${v.index}: ${escapeHtml(shortTitle)}${dur}</option>`;
    }).join('');
    const playing = getPlayingIndex(playlistData.videos);
    fromVidSelect.value = (followPlaying || !previousFrom)
      ? (playing || playlistData.currentVideoIndex || 1)
      : previousFrom;

    renderInlineVideoList();
    updateInlineRemaining();
  }

  function getFromIndex() {
    const sel = document.getElementById('yt-pa-from-vid-select');
    return clampIndex(sel ? sel.value : 1, playlistData ? playlistData.videos.length : 1);
  }

  // Seconds already watched of video `idx` if it is the one playing right now.
  function liveElapsedFor(idx) {
    if (!playlistData || idx !== getPlayingIndex(playlistData.videos)) return null;
    if (getPlaylistId() !== playlistData.playlistId) return null;
    const video = getMainVideo();
    if (!video || isAdPlaying() || !(video.duration > 0)) return { elapsed: 0, rate: 1 };
    return { elapsed: video.currentTime || 0, rate: video.playbackRate || 1 };
  }

  function updateInlineRemaining() {
    if (!playlistData || !playlistData.videos || playlistData.videos.length === 0) return;
    const fromIdx = getFromIndex();
    const live = liveElapsedFor(fromIdx);
    const rem = computeRemaining(playlistData.videos, fromIdx, live ? live.elapsed : 0);

    const badge = document.getElementById('yt-pa-rem-badge');
    if (badge) {
      badge.classList.toggle('live', !!live);
      if (live) {
        badge.textContent = `Now at Video ${fromIdx}`;
      } else if (fromIdx > 1) {
        badge.textContent = `From Video ${fromIdx}`;
      } else {
        badge.textContent = `Full Playlist (${playlistData.videos.length} vids)`;
      }
    }

    const cardSp = cardSpeed(settings.defaultSpeed);
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('yt-pa-rem-dur', formatDuration(rem.seconds));
    set('yt-pa-rem-count', `${rem.count} vids left`);
    set('yt-pa-rem-card-label', `At ${cardSp}×`);
    set('yt-pa-rem-15x', formatDuration(rem.seconds / cardSp));
    set('yt-pa-rem-2x', formatDuration(rem.seconds / 2));

    const liveRow = document.getElementById('yt-pa-rem-live-row');
    if (liveRow) {
      liveRow.style.display = live ? 'flex' : 'none';
      if (live) {
        const atRate = rem.seconds / live.rate;
        set('yt-pa-rem-live-finish', `${formatDuration(atRate)} at ${live.rate}× · ends ${clockAfter(atRate)}`);
      }
    }

    updateCustomCalc();
  }

  function updateCustomCalc() {
    if (!analysisData || !playlistData) return;
    const hrs = parseFloat(document.getElementById('yt-pa-custom-hrs')?.value) || 1;
    const spd = parseFloat(document.getElementById('yt-pa-custom-spd')?.value) || 1;
    const scope = document.getElementById('yt-pa-custom-scope')?.value || 'remaining';

    let targetSeconds = analysisData.totalSeconds;
    if (scope === 'remaining') {
      const fromIdx = getFromIndex();
      const live = liveElapsedFor(fromIdx);
      targetSeconds = computeRemaining(playlistData.videos, fromIdx, live ? live.elapsed : 0).seconds;
    }

    const el = document.getElementById('yt-pa-custom-days');
    const text = formatDays(daysToFinish(targetSeconds, spd, hrs));
    if (el && el.textContent !== text) el.textContent = text;
  }

  // Ticks every second while the playlist view is open: follows autoplay /
  // video changes and counts down the remaining time of the playing video.
  function startPlaylistLive() {
    stopPlaylistLive();
    playlistLiveTimer = setInterval(() => {
      if (!panelOpen || !isPlaylistPage() || !playlistData || !isContextValid()) {
        stopPlaylistLive();
        return;
      }
      syncPlayingVideo();
      updateInlineRemaining();
    }, 1000);
  }

  function syncPlayingVideo() {
    if (!playlistData) return;
    const playing = getPlayingIndex(playlistData.videos);
    if (!playing || playing === playlistData.currentVideoIndex) return;

    playlistData.currentVideoIndex = playing;
    if (followPlaying) {
      const sel = document.getElementById('yt-pa-from-vid-select');
      if (sel) sel.value = playing;
    }
    highlightInlineCurrentVideo();
  }

  function renderInlineVideoList() {
    const container = document.getElementById('yt-pa-videos-list');
    if (!container || !playlistData || !playlistData.videos) return;

    const fromIdx = getFromIndex();
    const playing = getPlayingIndex(playlistData.videos);
    const visible = getVisibleVideos(playlistData.videos, listView.query, listView.sort);

    if (visible.length === 0) {
      container.innerHTML = '<p class="yt-pa-empty-text">No videos match your search</p>';
      return;
    }

    container.innerHTML = visible.map(video => {
      const idx = video.index || 0;
      const classes = [
        'yt-pa-video-item',
        video.isUnavailable ? 'unavailable' : '',
        idx === fromIdx ? 'current-video' : '',
        idx < fromIdx ? 'watched-video' : '',
        idx === playing ? 'playing-video' : '',
        video.url ? 'has-link' : ''
      ].filter(Boolean).join(' ');
      return `
        <div class="${classes}" data-index="${idx}" title="${escapeHtml(video.title || '')}">
          <button type="button" class="yt-pa-vid-item-index" data-index="${idx}"
                  ${video.url ? '' : 'disabled'} aria-label="Play video ${idx}">${idx}</button>
          <span class="yt-pa-vid-item-title">${escapeHtml(video.title || 'Untitled')}</span>
          <span class="yt-pa-vid-item-duration">${video.durationFormatted || '--'}</span>
        </div>
      `;
    }).join('');
  }

  function onVideoListClick(e) {
    const item = e.target.closest('.yt-pa-video-item');
    if (!item || !playlistData) return;
    const idx = parseInt(item.dataset.index, 10);
    const video = playlistData.videos[idx - 1];
    if (!video || !video.url) return;

    if (e.ctrlKey || e.metaKey || e.button === 1) {
      window.open(video.url, '_blank', 'noopener');
      return;
    }
    openVideo(video);
  }

  // Opens a playlist video using YouTube's own (SPA) navigation when possible,
  // so the page doesn't fully reload and the panel stays in playlist mode.
  function openVideo(video) {
    activeWatchMode = 'playlist';
    followPlaying = true;
    const sel = document.getElementById('yt-pa-from-vid-select');
    if (sel) sel.value = video.index;

    navigateToVideoUrl(video.url, video.index);
    updateInlineRemaining();
    highlightInlineCurrentVideo();
  }

  // Clicks YouTube's own link for the video (SPA navigation, no reload).
  // Tries the item at `index` first (handles duplicates), then any matching item,
  // and falls back to a normal page load.
  function navigateToVideoUrl(url, index) {
    const targetId = videoIdFromUrl(url);
    if (!targetId) return false;

    const items = Array.from(getItemElements());
    const preferred = index ? items[index - 1] : null;
    const candidates = preferred ? [preferred, ...items] : items;
    for (const item of candidates) {
      const link = item.querySelector(ITEM_LINK_SELECTOR);
      if (link && videoIdFromUrl(link.href) === targetId) {
        link.click();
        return true;
      }
    }
    window.location.assign(url);
    return true;
  }

  function highlightInlineCurrentVideo() {
    const container = document.getElementById('yt-pa-videos-list');
    if (!container || !playlistData) return;
    const fromIdx = getFromIndex();
    const playing = getPlayingIndex(playlistData.videos);
    container.querySelectorAll('.yt-pa-video-item').forEach(item => {
      const idx = parseInt(item.dataset.index, 10);
      item.classList.toggle('current-video', idx === fromIdx);
      item.classList.toggle('watched-video', idx < fromIdx);
      item.classList.toggle('playing-video', idx === playing);
    });
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
    if (!settings.showFloatingBtn) btn.classList.add('yt-pa-off');
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

      setTimeout(() => {
        if (!isContextValid()) return;
        if (!document.getElementById('yt-playlist-analyzer-btn')) {
          injectFloatingButton();
        }
      }, 250);

      // Moving to another video of the SAME playlist (autoplay, clicking in the
      // queue or in our list): keep the loaded data and the current mode, and
      // just let the live overview pick up the new position.
      const samePlaylist = !!playlistData && getPlaylistId() === playlistData.playlistId &&
                           (isVideoWatchPage() || isDedicatedPlaylistPage());
      if (samePlaylist) {
        if (!panelOpen) return;
        if (isPlaylistPage()) {
          updateModeToggle();
          if (!playlistLiveTimer) {
            runAnalysis();
          } else {
            syncPlayingVideo();
            updateInlineRemaining();
          }
        } else {
          runAnalysis();
        }
        return;
      }

      // Different page: reset mode and stale cache
      activeWatchMode = null;
      playlistData = null;
      analysisData = null;
      stopVideoAnalyzer();
      stopPlaylistLive();

      if (panelOpen) {
        runAnalysis();
      } else {
        runId++;
      }
    }

    window.addEventListener('yt-navigate-finish', handleLocationChange);
    document.addEventListener('yt-navigate-finish', handleLocationChange);
    window.addEventListener('yt-page-data-updated', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);

    // Backup lightweight URL check (covers navigations that fire no YouTube event)
    setInterval(() => {
      if (!isContextValid()) return;
      if (window.location.href !== lastTrackedUrl) {
        handleLocationChange();
      }
    }, 1000);
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
  loadSettings();
  watchNavigation();
  setupFullscreenWatcher();
})();
