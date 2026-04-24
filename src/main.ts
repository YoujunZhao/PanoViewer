import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/video-plugin/index.css';
import './style.css';

import {
  detectPanoramaMediaType,
  getEquirectangularValidationDecision,
  ObjectUrlStore,
  type PanoramaMediaType,
  validateLikelyEquirectangular,
} from './lib/media-file';
import { PanoramaViewerController } from './lib/panorama-viewer';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app container');
}

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Pure Frontend 360 Toolkit</p>
        <h1>Panorama Image + Video Viewer</h1>
      </div>
      <p class="topbar-note">Upload local equirectangular panorama files, then drag, touch, zoom, and fullscreen preview.</p>
    </header>

    <main class="layout">
      <aside class="panel" aria-label="Upload controls">
        <h2>Load Local Panorama</h2>
        <p class="hint">Supported images: JPG, PNG, WEBP. Supported videos: MP4, WEBM, MOV.</p>

        <label class="file-picker" for="file-input">
          Choose image / video
          <input id="file-input" type="file" accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.m4v,.ogv" />
        </label>

        <div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Drop panorama file here or press enter to choose file">
          Drop file here
        </div>

        <div class="action-row">
          <button id="fullscreen-btn" type="button">Fullscreen</button>
          <button id="clear-btn" type="button" class="ghost">Clear</button>
        </div>

        <dl class="meta">
          <div>
            <dt>Mode</dt>
            <dd id="mode-value">none</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd id="file-value">-</dd>
          </div>
        </dl>

        <p id="status" class="status" aria-live="polite">Select or drop a panorama file to start.</p>
      </aside>

      <section class="viewer-card" aria-label="Panorama viewer">
        <div id="viewer" class="viewer"></div>
        <p class="viewer-tip">Drag or swipe to rotate, use wheel/pinch to zoom. Video mode includes play/pause, mute, and progress bar controls.</p>
      </section>
    </main>
  </div>
`;

const fileInput = document.querySelector<HTMLInputElement>('#file-input');
const dropzone = document.querySelector<HTMLDivElement>('#dropzone');
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreen-btn');
const clearButton = document.querySelector<HTMLButtonElement>('#clear-btn');
const modeValue = document.querySelector<HTMLElement>('#mode-value');
const fileValue = document.querySelector<HTMLElement>('#file-value');
const status = document.querySelector<HTMLElement>('#status');
const viewerContainer = document.querySelector<HTMLElement>('#viewer');

if (
  !fileInput ||
  !dropzone ||
  !fullscreenButton ||
  !clearButton ||
  !modeValue ||
  !fileValue ||
  !status ||
  !viewerContainer
) {
  throw new Error('Missing required UI elements');
}

const modeValueEl = modeValue;
const fileValueEl = fileValue;
const statusEl = status;
const fileInputEl = fileInput;

const viewerController = new PanoramaViewerController(viewerContainer);
const objectUrlStore = new ObjectUrlStore();

let currentObjectUrl: string | null = null;

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function setMeta(mode: PanoramaMediaType | null, fileName: string | null): void {
  modeValueEl.textContent = mode ?? 'none';
  fileValueEl.textContent = fileName ?? '-';
}

async function loadPanoramaFile(file: File): Promise<void> {
  const mediaType = detectPanoramaMediaType(file);

  if (!mediaType) {
    setStatus('Unsupported file format. Please use a panorama image or video file.', 'error');
    fileInputEl.value = '';
    return;
  }

  setStatus('Inspecting media metadata...');
  const looksLikePanorama = await validateLikelyEquirectangular(file, mediaType);
  const validationDecision = getEquirectangularValidationDecision(mediaType, looksLikePanorama);
  if (!validationDecision.allowLoad) {
    setStatus(validationDecision.message ?? 'File validation failed.', 'error');
    fileInputEl.value = '';
    return;
  }

  const previousObjectUrl = currentObjectUrl;
  const nextObjectUrl = objectUrlStore.create(file);

  try {
    setStatus('Loading panorama...');

    if (mediaType === 'image') {
      await viewerController.loadImage(nextObjectUrl);
    } else {
      await viewerController.loadVideo(nextObjectUrl);
    }

    currentObjectUrl = nextObjectUrl;
    objectUrlStore.revoke(previousObjectUrl);
    setMeta(mediaType, file.name);
    if (validationDecision.level === 'warning') {
      setStatus(validationDecision.message ?? 'Loaded with warning.');
    } else {
      setStatus('Loaded successfully. Drag to rotate and use wheel/pinch to zoom.');
    }
  } catch (error) {
    objectUrlStore.revoke(nextObjectUrl);
    objectUrlStore.revoke(previousObjectUrl);
    currentObjectUrl = null;
    setMeta(null, null);
    setStatus('Failed to render this panorama file. Please check format and try another one.', 'error');
    console.error(error);
  } finally {
    fileInputEl.value = '';
  }
}

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files ?? [];
  if (file) {
    void loadPanoramaFile(file);
  }
});

dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('is-dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('is-dragover');
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');

  const [file] = event.dataTransfer?.files ?? [];
  if (file) {
    void loadPanoramaFile(file);
  }
});

fullscreenButton.addEventListener('click', () => {
  if (!viewerController.toggleFullscreen()) {
    setStatus('Load a panorama first to use fullscreen mode.', 'error');
  }
});

clearButton.addEventListener('click', () => {
  viewerController.clear();
  objectUrlStore.revoke(currentObjectUrl);
  currentObjectUrl = null;
  setMeta(null, null);
  setStatus('Viewer cleared. Select another panorama file to continue.');
  fileInput.value = '';
});

window.addEventListener('beforeunload', () => {
  viewerController.destroy();
  objectUrlStore.revokeAll();
});
