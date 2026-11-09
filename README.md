# YouTube Playlist Analyzer

A Chrome extension that calculates how long a YouTube playlist or video will take to watch, at any playback speed, and helps you plan a viewing schedule. It runs entirely in the browser, needs no account or API key, and works on YouTube's pages without reloading them.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-red?style=flat-square&logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [Project Structure](#project-structure)
- [Technical Notes](#technical-notes)
- [Privacy](#privacy)
- [Contributing](#contributing)
- [License](#license)

## Features

### In-page panel

A floating button in the bottom-right corner of YouTube opens a compact panel styled to match YouTube's dark theme. The button and panel hide automatically during full-screen playback.

The panel follows YouTube's single-page navigation. When you move between playlists and videos, it updates on its own, with no page refresh. On a video that belongs to a playlist, a header switch (`View Playlist` / `View Video`) moves between the playlist analysis and the single-video analysis.

### Playlist analysis

**Overview**

- Remaining watch time from the current video, updated every second while a video plays. Time already watched of the current video is subtracted.
- Follows autoplay and queue navigation automatically. A `Now at Video N` badge shows the current position.
- Estimated finish time at your current playback speed.
- Choose any video as the starting point with the `From` selector.
- Totals for the whole playlist: duration, video count, average length, and duration at 2x.
- Shortest and longest videos.
- Deleted, private, live and upcoming videos are listed but left out of averages and extremes. The panel also says when a playlist could not be fully loaded.

**Speeds**

- Total duration at 1x, 1.25x, 1.5x, 1.75x, 2x, 2.5x and 3x, with a comparison bar for each.
- Time saved at 1.25x, 1.5x, 2x and 3x.

**Schedule**

- Days to finish at 30 minutes, 1, 2, 3 and 5 hours per day, at 1x, 1.5x and 2x.
- Custom calculator for any daily commitment (up to 24 hours) and playback speed, for either the remaining videos or the whole playlist.

**Videos**

- Search by title, combined with sorting by playlist order, shortest, longest, title A–Z or title Z–A. Title sorting is natural, so "Part 9" comes before "Part 10".
- Click a video, or its number, to play it in the current tab using YouTube's own navigation. Ctrl+click (Cmd+click on macOS) opens it in a new tab.
- The playing video and the videos already watched are marked.

### Single-video analysis

- Title, channel, playback progress and remaining time.
- Estimated finish time at the current playback speed.
- Remaining time and finish time at every speed from 1x to 3x.
- One-click buttons to change YouTube's playback speed.
- Time saved compared with normal speed.

### Toolbar popup

The popup offers the same playlist and video analysis from the browser toolbar. It adds a history of recently analyzed playlists and a settings panel.

## Installation

### Chrome Web Store

Install the published version from the Chrome Web Store listing.

### From source (developer mode)

1. Clone the repository:

   ```bash
   git clone https://github.com/trghcj/youtube-playlist-extension.git
   ```

2. Open `chrome://extensions/` in Google Chrome.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the cloned folder.
5. Refresh any YouTube tabs that were already open.

## Usage

1. Open a YouTube playlist (`https://www.youtube.com/playlist?list=...`) or a video (`https://www.youtube.com/watch?v=...`).
2. Click the red floating button in the bottom-right corner, or the extension icon in the toolbar.
3. The panel shows the playlist analysis on playlist pages and the video analysis on video pages. On a video inside a playlist, use the header switch to change between them.
4. Keep browsing. The panel updates as you navigate.

## Settings

Open the settings from the gear icon in the toolbar popup. Changes apply immediately, including to YouTube tabs that are already open.

| Setting | Effect |
| --- | --- |
| Default speed | Highlighted in the Speeds tab, shown in the Remaining card, and used as the custom calculator's default |
| Auto-analyze on popup open | When off, the popup waits until you click **Analyze this page** |
| Show floating button | Shows or hides the floating button on YouTube |
| Save analysis history | Turns recording of analyzed playlists on or off |

## Project Structure

```text
youtube-playlist-extension/
├── manifest.json            Manifest V3 configuration
├── lib/
│   └── core.js              Shared logic: parsing, formatting, analysis, sorting, settings
├── background/
│   └── background.js        Service worker: analysis history storage
├── content/
│   ├── content.js           Page data extraction, navigation tracking, in-page panel
│   └── content.css          In-page panel and floating button styles
├── popup/
│   ├── popup.html           Toolbar popup markup
│   ├── popup.css            Toolbar popup styles
│   └── popup.js             Toolbar popup logic
├── icons/                   Extension icons (16, 48, 128 px) and icon generator scripts
├── PRIVACY.md               Privacy policy
├── SECURITY.md              Security policy
└── LICENSE                  MIT license
```

## Technical Notes

- **Manifest V3.** Permissions are limited to `storage`, `activeTab` and `https://www.youtube.com/*`.
- **No external requests.** All data is read from the YouTube page you have open. No API keys, servers or third-party scripts are involved.
- **Single-page navigation.** The panel listens to YouTube's `yt-navigate-finish` and `yt-page-data-updated` events, with a light URL check as a fallback.
- **Performance.** There are no long-running observers on the whole page. Analysis of large playlists can be cancelled: it stops when you close the panel or leave the page, and it puts your scroll position back when it finishes.
- **Shared logic.** The popup and the in-page panel use the same calculation code in `lib/core.js`, so they always agree.

## Privacy

The extension collects no personal data and sends nothing over the network. Preferences and history are stored locally with `chrome.storage.local`. See [PRIVACY.md](PRIVACY.md) for the full policy.

## Contributing

Issues and pull requests are welcome on the [issues page](https://github.com/trghcj/youtube-playlist-extension/issues).

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Commit your changes: `git commit -m "feat: describe your change"`.
4. Push the branch: `git push origin feature/your-feature`.
5. Open a pull request.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
