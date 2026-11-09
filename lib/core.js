// Shared helpers for YouTube Playlist Analyzer.
// Loaded before content/content.js (content script) and popup/popup.js (popup page).
// Exposes a single global: YTPA.

(function (root) {
  'use strict';

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const TIME_SAVED_SPEEDS = [1.25, 1.5, 2, 3];
  const SCHEDULES = [
    { hoursPerDay: 0.5, label: '30 min/day' },
    { hoursPerDay: 1, label: '1 hr/day' },
    { hoursPerDay: 2, label: '2 hrs/day' },
    { hoursPerDay: 3, label: '3 hrs/day' },
    { hoursPerDay: 5, label: '5 hrs/day' }
  ];

  const DEFAULT_SETTINGS = {
    defaultSpeed: '1.5',
    autoAnalyze: true,
    showFloatingBtn: true,
    saveHistory: true
  };

  const SORTS = {
    'index': (a, b) => (a.index || 0) - (b.index || 0),
    'duration-asc': (a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0) || (a.index - b.index),
    'duration-desc': (a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0) || (a.index - b.index),
    'title-asc': (a, b) => compareTitles(a, b) || (a.index - b.index),
    'title-desc': (a, b) => compareTitles(b, a) || (a.index - b.index)
  };

  const titleCollator = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : null;

  function compareTitles(a, b) {
    const ta = (a.title || '').trim();
    const tb = (b.title || '').trim();
    return titleCollator ? titleCollator.compare(ta, tb) : ta.localeCompare(tb);
  }

  // "1:02:03" -> 3723. Anything that is not a clean timestamp (LIVE, UPCOMING,
  // SHORTS, localized labels...) returns 0 instead of NaN.
  function parseDuration(text) {
    if (!text) return 0;
    const clean = String(text).trim();
    if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(clean)) return 0;
    return clean.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
  }

  // 3723 -> "1:02:03"
  function formatTime(totalSeconds) {
    let s = Number(totalSeconds);
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // 3723 -> "1h 2m 3s"
  function formatDuration(totalSeconds) {
    let s = Number(totalSeconds);
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.round(s);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
  }

  function daysToFinish(seconds, speed, hoursPerDay) {
    if (!(seconds > 0) || !(speed > 0) || !(hoursPerDay > 0)) return 0;
    return Math.ceil((seconds / speed) / (hoursPerDay * 3600));
  }

  function formatDays(days) {
    if (!isFinite(days)) return '--';
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  function videoIdFromUrl(url) {
    if (!url) return null;
    try {
      return new URL(url, 'https://www.youtube.com').searchParams.get('v');
    } catch (e) {
      return null;
    }
  }

  // Videos with no readable duration (deleted, private, live, upcoming) are
  // still listed and counted, but excluded from average / shortest / longest.
  function analyzePlaylist(videos) {
    const list = Array.isArray(videos) ? videos : [];
    const timed = list.filter(v => v.durationSeconds > 0);
    const totalSeconds = timed.reduce((sum, v) => sum + v.durationSeconds, 0);
    const averageSeconds = timed.length ? Math.round(totalSeconds / timed.length) : 0;
    const sorted = [...timed].sort(SORTS['duration-asc']);

    const speedAnalysis = SPEEDS.map(speed => {
      const secs = Math.round(totalSeconds / speed);
      return { speed, totalSeconds: secs, formatted: formatDuration(secs) };
    });

    const dailySchedules = SCHEDULES.map(s => ({
      ...s,
      days: daysToFinish(totalSeconds, 1, s.hoursPerDay),
      daysAt1_5x: daysToFinish(totalSeconds, 1.5, s.hoursPerDay),
      daysAt2x: daysToFinish(totalSeconds, 2, s.hoursPerDay)
    }));

    return {
      totalVideos: list.length,
      timedVideos: timed.length,
      untimedVideos: list.length - timed.length,
      totalSeconds,
      totalDuration: formatDuration(totalSeconds),
      averageSeconds,
      averageDuration: formatDuration(averageSeconds),
      shortest: sorted[0] || null,
      longest: sorted[sorted.length - 1] || null,
      speedAnalysis,
      dailySchedules
    };
  }

  function clampIndex(idx, total) {
    return Math.max(1, Math.min(parseInt(idx, 10) || 1, Math.max(1, total)));
  }

  // Remaining time from video `fromIdx` (1-based) to the end.
  // `elapsedInFirst` lets callers subtract what has already been watched of
  // the first video (live progress), clamped to that video's duration.
  function computeRemaining(videos, fromIdx, elapsedInFirst) {
    const list = Array.isArray(videos) ? videos : [];
    const idx = clampIndex(fromIdx, list.length);
    const rest = list.slice(idx - 1);
    let seconds = rest.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    const first = rest[0];
    const elapsed = Math.max(0, Math.min(Number(elapsedInFirst) || 0, first ? first.durationSeconds || 0 : 0));
    seconds = Math.max(0, seconds - elapsed);
    return { fromIdx: idx, count: rest.length, seconds, elapsed };
  }

  function getVisibleVideos(videos, query, sortKey) {
    const list = Array.isArray(videos) ? videos : [];
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? list.filter(v => (v.title || '').toLowerCase().includes(q)) : [...list];
    return filtered.sort(SORTS[sortKey] || SORTS.index);
  }

  // Speed shown in the highlighted "At N×" card. Uses the user's default speed
  // unless it is 1× (pointless) or 2× (already shown in the neighbouring card).
  function cardSpeed(defaultSpeed) {
    const sp = parseFloat(defaultSpeed);
    return (sp > 1 && sp < 2) ? sp : 1.5;
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  root.YTPA = {
    SPEEDS,
    TIME_SAVED_SPEEDS,
    SCHEDULES,
    DEFAULT_SETTINGS,
    parseDuration,
    formatTime,
    formatDuration,
    escapeHtml,
    daysToFinish,
    formatDays,
    videoIdFromUrl,
    analyzePlaylist,
    clampIndex,
    computeRemaining,
    getVisibleVideos,
    cardSpeed,
    loadSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
