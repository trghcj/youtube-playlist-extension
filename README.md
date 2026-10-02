# 🎬 YouTube Playlist Analyzer - Chrome Extension

A powerful, elegant Chrome extension that stays on YouTube and analyzes playlists with a single click. Extract playlist details, view total length, calculate exact completion times at speeds from 1x to 3x, plan daily schedules, and more.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-red?style=flat-square&logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

---

## ✨ Features

### 🔴 In-Page Floating Bubble & Slide-Up Panel
- Stays seamlessly on YouTube with a sleek, non-intrusive floating red bubble in the bottom-right corner.
- Click the bubble on any playlist to immediately open an interactive slide-up panel.
- Pinned header with close button (`×`) and navigation tabs that always stay visible while scrolling.

### 📊 Clean Overview
- **Total Duration** — Full playlist runtime formatted in hours, minutes, and seconds.
- **Video Count** — Total number of videos in the playlist.
- **Average Length** — Average duration per video.
- **At 2x Speed** — Instant calculation of total watch time at double speed.
- **Shortest & Longest** — Quickly spot the shortest and longest videos.

### ⚡ Speeds Analysis
- View completion times at **1x, 1.25x, 1.5x, 1.75x, 2x, 2.5x, and 3x** playback speeds.
- Visual progress bars showing relative watch time.
- **Time You Save** card — see exactly how much total time you save at 1.25x, 1.5x, 2x, and 3x speeds.

### 📅 Completion Schedule & Custom Calculator
- **Watch Time Table** — Days to complete based on 30 min, 1 hr, 2 hrs, 3 hrs, or 5 hrs per day (at 1x, 1.5x, and 2x).
- **Custom Calculator** — Select daily commitment from a **1 to 24 hours/day** dropdown and your preferred playback speed to instantly compute how many days you'll need to finish.

### 📋 Full Toolbar Popup
- You can also click the extension icon in the Chrome toolbar.
- Includes a dedicated **Videos Tab** with search filter and sorting (by playlist order, shortest first, or longest first).
- **History Panel** — Saves your recently analyzed playlists.
- **Settings Panel** — Configure default speed, auto-analyze, and floating button preferences.

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

5. Select the cloned `youtube-playlist-extension` folder.

6. The extension is now installed and active! 🎉

---

## 📖 How to Use

1. Open any YouTube playlist page (e.g. `https://www.youtube.com/playlist?list=...` or video inside a playlist).
2. Click the **red floating bubble** in the bottom-right corner of the page (or click the extension icon in Chrome's toolbar).
3. Switch between tabs:
   - **Overview** — High-level statistics and extreme durations.
   - **Speeds** — Breakdown of watch time across playback speeds and total time saved.
   - **Schedule** — Daily study/watch planner with custom hours and speed calculator.

---

## 🏗️ Project Structure

```
youtube-playlist-extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background/
│   └── background.js          # Service worker (analytics, storage, history)
├── content/
│   ├── content.js             # YouTube DOM extraction & in-page floating UI
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

## 🛠️ Technical Details

- **Manifest V3** compliant.
- **No external API keys required** — parses playlist data directly and privately in your browser.
- **Single Page Application (SPA) Support** — automatically detects YouTube URL changes without requiring page reloads.
- **Chrome Storage API** — local storage for history and user preferences.

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
