# Privacy Policy for YouTube Playlist & Video Analyzer

**Last Updated:** October 2, 2026

This extension ("YouTube Playlist Analyzer") is committed to protecting your privacy. This Privacy Policy explains our data practices.

## 1. No Data Collection
YouTube Playlist Analyzer **does not collect, store, transmit, or share any personal information or user data**. 

- We do not require any account registration or login.
- We do not track your browsing history or keystrokes.
- We do not use analytics trackers, telemetry, or third-party tracking scripts.
- We do not sell, rent, or trade user data to any third parties.

## 2. Local Browser Operation
All calculations, duration analyses, and playback speed estimations are executed **100% locally within your browser**:
- **DOM Inspection**: The extension reads playlist item lengths and video duration timestamps directly from the active YouTube webpage DOM to compute totals, averages, and schedules.
- **Local Storage (`chrome.storage.local`)**: Used exclusively on your device to remember your custom preferences (such as default playback speed) and locally cache your recently analyzed playlists. This data stays on your machine and is never sent across any network.

## 3. Permissions Justification
- `activeTab`: Used solely to interact with the active YouTube tab when you click the extension action button.
- `storage`: Used solely to save user preferences locally on your computer.
- `host_permissions (*://*.youtube.com/*)`: Required to read video runtime metadata and inject the in-page analyzer panel directly onto YouTube pages.

## 4. Remote Code
This extension does not load or execute any remote code, external scripts, or CDNs. All source code is bundled inside the extension package.

## 5. Contact & Inquiries
If you have any questions about this Privacy Policy, please open an issue or contact the maintainer at:
- GitHub: [https://github.com/trghcj/youtube-playlist-extension](https://github.com/trghcj/youtube-playlist-extension)
