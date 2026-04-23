# 360 Panorama Viewer (Static Frontend)

Pure frontend 360 panorama viewer based on Photo Sphere Viewer + TypeScript + Vite.

It supports loading local equirectangular panorama images and videos directly in browser using File API + URL.createObjectURL(), without any backend.

## Features

- Upload local equirectangular panorama image and video files
- Drag and touch to rotate viewpoint
- Mouse wheel / pinch zoom
- Fullscreen viewing
- Video mode controls: play/pause, mute, time/progress bar (via VideoPlugin)
- Drag-and-drop file loading
- Client-side 2:1 ratio validation for likely equirectangular files

## Tech Stack

- Vite
- TypeScript
- Photo Sphere Viewer
	- @photo-sphere-viewer/core
	- @photo-sphere-viewer/equirectangular-video-adapter
	- @photo-sphere-viewer/video-plugin
- Vitest + jsdom (unit tests)

## Development

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Run tests:

```bash
npm run test
```

Build production bundle:

```bash
npm run build
```

Preview production bundle:

```bash
npm run preview
```

## Deployment

This app is configured as static frontend and can be deployed directly from the generated dist directory.

The Vite base is configured as relative path (`./`) in vite.config.ts, which works well for static hosts.

### GitHub Pages

1. Run `npm run build`
2. Deploy `dist/` to GitHub Pages (for example with gh-pages action or upload to `gh-pages` branch)
3. Ensure Pages serves static files from the deployed folder

### Vercel

Use these settings:

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

### Cloudflare Pages

Use these settings:

- Build Command: `npm run build`
- Build output directory: `dist`
- Node version: 20+

## Notes

- Panorama images/videos are expected to be equirectangular and close to 2:1 ratio.
- Very large video panoramas may be limited by browser/GPU capabilities.
