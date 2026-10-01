# 🎬 YouTube Playlist Analyzer - Chrome Extension

A powerful Chrome extension that analyzes YouTube playlists and tells you exactly how long they'll take to complete at different playback speeds.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?style=flat-square&logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## ✨ Features

### 📊 Playlist Overview
- **Total Duration** — See the complete playlist length at a glance
- **Total Videos** — Count of all videos in the playlist
- **Average Duration** — Average length per video
- **Shortest & Longest** — Identify the extreme videos

### ⚡ Speed Analysis
- View completion time at **1x, 1.25x, 1.5x, 1.75x, 2x, 2.5x, 3x** speeds
- Visual progress bars showing relative time
- **Time Saved** calculator — see exactly how much time you save at each speed
- Recommended speed highlight (1.5x)

### 📅 Completion Schedule
- See how many **days to complete** based on daily watch time:
  - 30 min/day, 1 hr/day, 2 hrs/day, 3 hrs/day, 5 hrs/day
- Schedule shown for **1x, 1.5x, and 2x** speeds
- **Custom Calculator** — input your own hours/day and speed

### 📋 Video List
- Browse all videos with duration
- **Search** through videos by title
- **Sort** by order, shortest first, or longest first
- Click any video to open it
- Unavailable videos are marked

### 🔄 Extra Features
- **Floating Button** — appears on YouTube playlist pages for quick access
- **Analysis History** — saves your past analyzed playlists
- **Settings Panel** — customize default speed, auto-analyze, and more
- **Dark Theme** — matches YouTube's dark mode perfectly
- **SPA Navigation** — works with YouTube's single-page navigation

## 🚀 Installation

### From Source (Developer Mode)

1. **Download/Clone** this repository:
   ```bash
   git clone <repository-url>
   ```

2. Open **Chrome** and go to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right corner)

4. Click **"Load unpacked"**

5. Select the `youtube-playlist-analyzer` folder

6. The extension icon will appear in your toolbar! 🎉

## 📖 How to Use

1. Navigate to any **YouTube playlist** page
2. Click the **extension icon** in the toolbar (or the floating red button on the page)
3. The extension automatically extracts and analyzes the playlist
4. Browse through the tabs:
   - **Overview** — Quick stats at a glance
   - **Speeds** — Time at different playback speeds
   - **Schedule** — Daily completion planner
   - **Videos** — Full video list with search & sort

## 🏗️ Project Structure

```
youtube-playlist-analyzer/
├── manifest.json              # Extension manifest (V3)
├── background/
│   └── background.js          # Service worker - analysis & storage
├── content/
│   ├── content.js             # YouTube DOM extraction & floating button
│   └── content.css            # Floating button styles
├── popup/
│   ├── popup.html             # Main popup UI
│   ├── popup.css              # Dark-themed styles
│   └── popup.js               # Interactive popup logic
├── icons/
│   ├── icon16.png             # 16x16 toolbar icon
│   ├── icon48.png             # 48x48 management icon
│   └── icon128.png            # 128x128 store icon
└── README.md                  # This file
```

## 🛠️ Technical Details

- **Manifest V3** — Latest Chrome extension standard
- **No external APIs** — All analysis done locally from DOM
- **Chrome Storage API** — For settings and history persistence
- **Content Scripts** — For YouTube page interaction
- **Service Worker** — Background processing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

---

**Made with ❤️ for productivity enthusiasts who watch too many YouTube playlists!**
