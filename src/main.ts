import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/video-plugin/index.css';
import './style.css';

import {
  buildVideoTranscodeCommands,
  detectPanoramaMediaType,
  getEquirectangularValidationDecision,
  getVideoLoadFailureMessage,
  ObjectUrlStore,
  preflightVideoPlayback,
  sniffVideoCompatibilityHint,
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

        <section id="transcode-help" class="transcode-help" hidden aria-live="polite">
          <h3>Conversion Helper</h3>
          <p id="transcode-reason" class="transcode-reason"></p>

          <p class="transcode-label">MP4 (H.264/AVC + AAC)</p>
          <pre id="transcode-mp4" class="transcode-code"></pre>
          <button id="copy-mp4-btn" type="button" class="ghost copy-btn">Copy MP4 command</button>

          <p class="transcode-label">WebM (VP9 + Opus)</p>
          <pre id="transcode-webm" class="transcode-code"></pre>
          <button id="copy-webm-btn" type="button" class="ghost copy-btn">Copy WebM command</button>
        </section>
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
const transcodeHelp = document.querySelector<HTMLElement>('#transcode-help');
const transcodeReason = document.querySelector<HTMLElement>('#transcode-reason');
const transcodeMp4 = document.querySelector<HTMLElement>('#transcode-mp4');
const transcodeWebm = document.querySelector<HTMLElement>('#transcode-webm');
const copyMp4Button = document.querySelector<HTMLButtonElement>('#copy-mp4-btn');
const copyWebmButton = document.querySelector<HTMLButtonElement>('#copy-webm-btn');
const viewerContainer = document.querySelector<HTMLElement>('#viewer');

if (
  !fileInput ||
  !dropzone ||
  !fullscreenButton ||
  !clearButton ||
  !modeValue ||
  !fileValue ||
  !status ||
  !transcodeHelp ||
  !transcodeReason ||
  !transcodeMp4 ||
  !transcodeWebm ||
  !copyMp4Button ||
  !copyWebmButton ||
  !viewerContainer
) {
  throw new Error('Missing required UI elements');
}

const modeValueEl = modeValue;
const fileValueEl = fileValue;
const statusEl = status;
const transcodeHelpEl = transcodeHelp;
const transcodeReasonEl = transcodeReason;
const transcodeMp4El = transcodeMp4;
const transcodeWebmEl = transcodeWebm;
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

function shouldShowTranscodeHelp(errorMessage: string): boolean {
  return /not supported|cannot decode|failed to decode|could not read/i.test(errorMessage);
}

function hideTranscodeHelp(): void {
  transcodeHelpEl.hidden = true;
  transcodeReasonEl.textContent = '';
  transcodeMp4El.textContent = '';
  transcodeWebmEl.textContent = '';
}

function showTranscodeHelp(fileName: string, reason: string | null): void {
  const commands = buildVideoTranscodeCommands(fileName);
  transcodeReasonEl.textContent = reason ?? 'Your browser cannot decode this uploaded video directly. Convert it with one of the commands below and upload the converted file.';
  transcodeMp4El.textContent = commands.mp4;
  transcodeWebmEl.textContent = commands.webm;
  transcodeHelpEl.hidden = false;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (!document.body) {
    throw new Error('Clipboard copy is unavailable until document body is ready.');
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';

  try {
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('Clipboard copy is unavailable in this browser.');
    }
  } finally {
    textArea.remove();
  }
}

async function copyCommandToClipboard(command: string, label: string): Promise<void> {
  if (!command.trim()) {
    setStatus('No command available to copy yet.', 'error');
    return;
  }

  try {
    await writeClipboardText(command);
    setStatus(`${label} command copied. Run it in a terminal with ffmpeg installed.`);
  } catch {
    setStatus('Copy failed in this browser. You can still select and copy the command text manually.', 'error');
  }
}

hideTranscodeHelp();

async function loadPanoramaFile(file: File): Promise<void> {
  const mediaType = detectPanoramaMediaType(file);

  if (!mediaType) {
    hideTranscodeHelp();
    setStatus('Unsupported file format. Please use a panorama image or video file.', 'error');
    fileInputEl.value = '';
    return;
  }

  hideTranscodeHelp();
  setStatus('Inspecting media metadata...');
  const looksLikePanorama = await validateLikelyEquirectangular(file, mediaType);
  const validationDecision = getEquirectangularValidationDecision(mediaType, looksLikePanorama);
  if (!validationDecision.allowLoad) {
    hideTranscodeHelp();
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
      await preflightVideoPlayback(nextObjectUrl, file.type);
      await viewerController.loadVideo(nextObjectUrl);
    }

    currentObjectUrl = nextObjectUrl;
    objectUrlStore.revoke(previousObjectUrl);
    setMeta(mediaType, file.name);
    hideTranscodeHelp();
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
    if (mediaType === 'video') {
      const failureMessage = getVideoLoadFailureMessage(error);
      setStatus(failureMessage, 'error');

      if (shouldShowTranscodeHelp(failureMessage)) {
        const streamHint = await sniffVideoCompatibilityHint(file);
        showTranscodeHelp(file.name, streamHint);
      }
    } else {
      hideTranscodeHelp();
      setStatus('Failed to render this panorama file. Please check format and try another one.', 'error');
    }
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

copyMp4Button.addEventListener('click', () => {
  void copyCommandToClipboard(transcodeMp4El.textContent ?? '', 'MP4');
});

copyWebmButton.addEventListener('click', () => {
  void copyCommandToClipboard(transcodeWebmEl.textContent ?? '', 'WebM');
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
  hideTranscodeHelp();
  setStatus('Viewer cleared. Select another panorama file to continue.');
  fileInput.value = '';
});

window.addEventListener('beforeunload', () => {
  viewerController.destroy();
  objectUrlStore.revokeAll();
});
