// Content script - runs on YouTube pages
// Extracts playlist data from the YouTube DOM

(function() {
  'use strict';

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_PLAYLIST_DATA') {
      extractPlaylistData()
        .then(data => sendResponse({ success: true, data }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async
    }

    if (message.type === 'CHECK_PLAYLIST_PAGE') {
      const isPlaylist = isPlaylistPage();
      sendResponse({ isPlaylist, url: window.location.href });
      return false;
    }
  });

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

    // Handle formats like "1:23:45", "23:45", "0:45"
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

    // Wait for playlist to load
    await waitForElement('ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer');

    // Try to get playlist title
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

    // Try to get channel/creator name
    let channelName = '';
    const channelEl = document.querySelector(
      '#owner-text a, ' +
      '.ytd-playlist-header-renderer #owner-text a, ' +
      'ytd-playlist-byline-renderer .yt-formatted-string'
    );
    if (channelEl) {
      channelName = channelEl.textContent.trim();
    }

    // First, try to scroll and load all videos in the playlist page view
    const isFullPlaylistPage = window.location.pathname === '/playlist';
    if (isFullPlaylistPage) {
      await scrollToLoadAllVideos();
    }

    // Extract video data
    const videos = extractVideoItems();

    if (videos.length === 0) {
      throw new Error('Could not extract video data. Make sure you are on a playlist page with visible videos.');
    }

    // Get total video count from header if available
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
    
    // Try playlist page renderers first
    let videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
    
    // Fallback to panel renderers (mini player playlist)
    if (videoElements.length === 0) {
      videoElements = document.querySelectorAll('ytd-playlist-panel-video-renderer');
    }

    videoElements.forEach((el, index) => {
      const titleEl = el.querySelector('#video-title');
      const title = titleEl ? titleEl.textContent.trim() : `Video ${index + 1}`;

      // Get duration - multiple possible selectors
      let durationSeconds = 0;
      const durationEl = el.querySelector(
        'ytd-thumbnail-overlay-time-status-renderer #text, ' +
        'span.ytd-thumbnail-overlay-time-status-renderer, ' +
        '.badge-shape-wiz__text'
      );
      if (durationEl) {
        const durationText = durationEl.textContent.trim();
        // Skip live/premiere indicators
        if (!durationText.match(/live|premiere|shorts/i)) {
          durationSeconds = parseDurationString(durationText);
        }
      }

      // Get channel name for individual video
      let videoChannel = '';
      const vidChannelEl = el.querySelector('#channel-name yt-formatted-string a, .ytd-channel-name a');
      if (vidChannelEl) {
        videoChannel = vidChannelEl.textContent.trim();
      }

      // Get video URL
      let videoUrl = '';
      const linkEl = el.querySelector('a#video-title, a.ytd-playlist-video-renderer');
      if (linkEl) {
        videoUrl = linkEl.href;
      }

      // Check if video is unavailable
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

  async function scrollToLoadAllVideos() {
    const maxScrollAttempts = 100; // Safety limit
    let lastCount = 0;
    let sameCountStreak = 0;

    for (let i = 0; i < maxScrollAttempts; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(800);

      const currentCount = document.querySelectorAll('ytd-playlist-video-renderer').length;
      if (currentCount === lastCount) {
        sameCountStreak++;
        if (sameCountStreak >= 3) break; // No new videos loaded after 3 attempts
      } else {
        sameCountStreak = 0;
      }
      lastCount = currentCount;

      // Send progress update
      chrome.runtime.sendMessage({
        type: 'SCROLL_PROGRESS',
        data: { loaded: currentCount, attempt: i + 1 }
      });
    }

    // Scroll back to top
    window.scrollTo(0, 0);
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
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
        observer.disconnect();
        // Don't reject - try to proceed anyway
        resolve(null);
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Inject a floating button on playlist pages
  function injectFloatingButton() {
    if (document.getElementById('yt-playlist-analyzer-btn')) return;
    if (!isPlaylistPage()) return;

    const btn = document.createElement('div');
    btn.id = 'yt-playlist-analyzer-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2v-4H8l4-4 4 4h-2v4z"/>
      </svg>
      <span class="yt-pa-tooltip">Analyze Playlist</span>
    `;
    btn.title = 'Analyze this playlist';
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });
    document.body.appendChild(btn);
  }

  // Watch for navigation changes (YouTube is SPA)
  function watchNavigation() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(() => {
          const existingBtn = document.getElementById('yt-playlist-analyzer-btn');
          if (existingBtn) existingBtn.remove();
          if (isPlaylistPage()) {
            injectFloatingButton();
          }
        }, 1500);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Initialize
  if (isPlaylistPage()) {
    injectFloatingButton();
  }
  watchNavigation();
})();
