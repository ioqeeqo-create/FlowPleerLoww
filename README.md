# Nexory

**Nexory** is an Electron desktop music player with social rooms, shared playback, and a customizable “liquid glass” UI. The GitHub project repository is **[NexoryND](https://github.com/ioqeeqo-create/NexoryND)** (product name in the app: Nexory).

## Current release

- **Version:** 3.0.2 (see `package.json` for the exact value on your checkout).
- **Windows:** run `npm run build:win` to produce `dist/Nexory-Setup.exe` (installer) and `dist/Nexory-Portable.exe` (portable).

Publishing a GitHub Release with artifacts:

- **electron-builder** (needs `GH_TOKEN` with `repo` scope): `npm run release:win`
- **GitHub CLI** (after `npm run build:win`):  
  `gh release create v3.0.0 --repo ioqeeqo-create/NexoryND dist/Nexory-Setup.exe dist/Nexory-Portable.exe dist/latest.yml dist/Nexory-Setup.exe.blockmap --title "Nexory v3.0.0" --notes-file RELEASE_NOTES.md`

## Key features

- Full player with lyrics/karaoke, playlists, likes, and profile customization.
- Room listening with host controls and shared queue; invite and member sync through cloud relay.
- Multi-source music search (Yandex, VK, SoundCloud hybrid chain, Spotify where supported, local playback).
- Built-in app updater (check/download/install).
- Visual settings: background blur/brightness, glass opacity and panel blur.
- `.flowpreset` **export** stores the full `flow_*` snapshot; **import** applies appearance and related visual keys.
- Default UI font: bundled pixel font in `assets/fonts/minecraft.ttf` (with webfont fallbacks).

## Social/Room status

- Server-side friend presence (online/offline) from social backend.
- Explicit host transfer + server election fallback.
- Authoritative room queue synchronization and host-only transport control.

## Local development

```bash
npm install
npm start
```

The renderer is assembled from `renderer-src/`; `npm start` runs `merge-renderer` automatically via `prestart`.

## License

Project metadata uses the MIT license in `package.json`. Third-party fonts and trademarks belong to their respective owners.
