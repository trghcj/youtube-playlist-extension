# 🎬 YouTube Playlist & Video Analyzer - Chrome Extension

A minimal, production-ready Chrome extension that lives seamlessly inside YouTube. Analyze full playlists or individual videos with a single click. Calculate exact completion times at playback speeds from 1× to 3×, view real-time countdown clocks, plan daily study schedules, and switch playback speeds on the fly — **with instant live updates as you navigate across YouTube**.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-red?style=flat-square&logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

---

## ✨ Features

### 🔴 Signature Floating Trigger & Pinned Panel
- Stays subtly on YouTube with the recognizable **red floating trigger button** in the bottom-right corner.
- Automatically hides during native full-screen video playback (`F`) to ensure zero distraction.
- Opens a clean, compact slide-up utility panel (`12px` border radius, `#181818` dark surface) that matches YouTube's native design system.
- Pinned header with clean `×` close button and persistent navigation.

---

### 🔄 Seamless Live Updates (Zero Page Reloads)
- **Instant Route Detection**: Hooks directly into native YouTube SPA events (`yt-navigate-finish`, `yt-page-data-updated`, `popstate`).
- **Live Transition Between Playlists and Videos**: When switching from a playlist (`/playlist`) to a video (`/watch`), or from a video back to a playlist, the extension automatically clears stale states and **live-updates the active panel immediately** without requiring a page refresh.
- **Dual-Mode Support on Watch Pages**: When watching a video that belongs to a playlist queue, the panel defaults to **Video Analyzer** with an intuitive `View Playlist ❯` / `View Video ❯` switcher in the header to easily analyze either the playing video or the entire playlist.
- **Video-to-Video Transitions**: Automatically refreshes when autoplaying or clicking recommended videos.

---

### 📑 1. Playlist Analyzer Mode
*(Active on playlist pages or via the playlist toggle)*

- **Overview Tab**:
  - **Total Duration**: Exact combined runtime in hours, minutes, and seconds.
  - **Video Count**: Total number of videos extracted from the playlist.
  - **Average Length**: Average video duration across the collection.
  - **At 2× Speed**: Quick calculation of total watch time at double speed.
  - **Shortest & Longest**: Direct preview of the extreme video lengths with duration badges.
- **Speeds Tab**:
  - Compact speed comparison table across **1×, 1.25×, 1.5×, 1.75×, 2×, 2.5×, and 3×**.
  - Thin, subtle progress bars with active speed indicator.
  - **Time Saved**: Clean breakdown of how much total time you save at 1.25×, 1.5×, 2×, and 3× speeds (e.g., `At 2×: 51m 58s`).
- **Schedule Tab**:
  - **Daily Watch Time Matrix**: Days to complete based on 30 min, 1 hr, 2 hrs, 3 hrs, or 5 hrs per day at 1×, 1.5×, and 2× speeds.
  - **Custom Calculator**: Select any daily watch commitment from **1 to 24 hours/day** and playback speed to compute exact completion days.

---

### 🎥 2. Video Analyzer Mode
*(Active on individual video watch pages)*

- **Live Video Meta**: Displays the currently playing video title and channel name.
- **Real-Time Progress**: Smooth animated progress bar with current and total playback timestamps.
- **Estimated Finish Clock**: Dynamic finish badge showing the exact clock time the video will finish (e.g., `Ends at 10:45 PM`) and remaining time based on your current playback speed.
- **Speed & Finish Breakdown**: Tabular rows showing remaining duration and completion clock at every speed (1× to 3×).
- **Instant Speed Switcher**: One-click `Set Speed` buttons to instantly change YouTube's video playback rate without opening YouTube's playback menu.
- **Time Saved**: Live calculation of minutes and seconds saved compared to normal speed.

---

### 📋 3. Full Toolbar Popup
- Click the extension icon in the Chrome toolbar at any time.
- Dedicated **Videos Tab** with instant search filter and sorting (playlist order, shortest first, longest first).
- **History Panel**: Automatically records your recently analyzed playlists.
- **Settings Panel**: Customize default speed, auto-analysis, and floating trigger preferences.

---

## 🚀 Installation

### Load Unpacked in Chrome (Developer Mode)

1. **Clone this repository**:
   ```bash
   git clone https://github.com/trghcj/youtube-playlist-extension.git
   ```
   *(Or download the ZIP and extract it)*

2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```

3. Turn on the **Developer mode** toggle in the top-right corner.

4. Click the **"Load unpacked"** button in the top-left corner.

5. Select the cloned `youtube-playlist-extension` directory.

6. The extension is installed and ready to use! 🎉

---

## 📖 How to Use

1. Open any YouTube playlist (e.g. `https://www.youtube.com/playlist?list=...`) or any video (`https://www.youtube.com/watch?v=...`).
2. Click the **red floating bubble** in the bottom-right corner of the page.
3. The panel opens and instantly displays:
   - **Playlist Analyzer** if you are on a playlist page.
   - **Video Analyzer** if you are on a video page.
   - On a video page with a playlist queue, use `View Playlist ❯` / `View Video ❯` in the header to switch between video and playlist analysis.
4. Navigate freely across YouTube — the panel updates live on route changes with zero page reloads needed!

---

## 🏗️ Project Structure

```text
youtube-playlist-extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background/
│   └── background.js          # Service worker (analytics, storage, history)
├── content/
│   ├── content.js             # YouTube DOM extraction, live SPA sync & inline panel
│   └── content.css            # Dark theme styles & pinned panel layout
├── popup/
│   ├── popup.html             # Toolbar popup interface
│   ├── popup.css              # Popup styling & theme
│   └── popup.js               # Popup logic, search, sort & settings
├── icons/
│   ├── icon16.png             # 16x16 toolbar icon
│   ├── icon48.png             # 48x48 extensions manager icon
│   └── icon128.png            # 128x128 store/display icon
└── README.md                  # Project documentation
```

---

## 🛠️ Technical Highlights

- **Manifest V3** compliant.
- **Zero Heavy Observers**: Avoids recursive DOM subtree observers and `body:has()` selectors for lag-free video playback and zoom performance.
- **Native SPA Integration**: Automatically responds to YouTube's internal `yt-navigate-finish` and `yt-page-data-updated` lifecycle events.
- **No External API Keys Required**: Safely parses playlist and video data directly inside your browser.
- **Local Storage**: Uses Chrome's Storage API for saved history and preferences.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/trghcj/youtube-playlist-extension/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
