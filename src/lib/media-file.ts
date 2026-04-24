export type PanoramaMediaType = 'image' | 'video';

export type EquirectangularValidationDecision = {
  allowLoad: boolean;
  level: 'ok' | 'warning' | 'error';
  message: string | null;
};

export type VideoTranscodeCommands = {
  mp4: string;
  webm: string;
};

const VIDEO_TRANSCODE_TIP = 'Please convert the video to MP4 (H.264/AVC + AAC, yuv420p, faststart) or WebM (VP9 + Opus).';
const MAX_SNIFF_BYTES = 256 * 1024;
const LEGACY_CODEC_MARKERS = ['mp4v', 'xvid', 'divx'];
const MODERN_CODEC_MARKERS = ['avc1', 'hvc1', 'hev1', 'vp09', 'av01'];
const MPEG2_SEQUENCE_HEADER = [0x00, 0x00, 0x01, 0xb3];

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'heic',
  'heif',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

function getFileExtension(fileName: string): string {
  const ext = fileName.split('.').pop();
  return ext ? ext.toLowerCase() : '';
}

function toSafeOutputStem(fileName: string): string {
  const trimmed = fileName.trim();
  const fileStem = trimmed.replace(/\.[^./\\]+$/, '');
  const safe = fileStem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return safe || 'panorama';
}

function quoteShellArgument(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function containsBytePattern(haystack: Uint8Array, pattern: readonly number[]): boolean {
  if (!pattern.length || pattern.length > haystack.length) {
    return false;
  }

  const maxStart = haystack.length - pattern.length;
  for (let i = 0; i <= maxStart; i += 1) {
    let matches = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (haystack[i + j] !== pattern[j]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function containsAsciiToken(haystack: Uint8Array, token: string): boolean {
  const tokenBytes = Array.from(token).map((char) => char.charCodeAt(0));
  return containsBytePattern(haystack, tokenBytes);
}

export function buildVideoTranscodeCommands(fileName: string): VideoTranscodeCommands {
  const inputName = fileName.trim() || 'input.mp4';
  const outputStem = toSafeOutputStem(inputName);
  const inputArg = quoteShellArgument(inputName);
  const outputMp4Arg = quoteShellArgument(`${outputStem}-h264.mp4`);
  const outputWebmArg = quoteShellArgument(`${outputStem}-vp9.webm`);

  return {
    mp4: `ffmpeg -i ${inputArg} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -profile:v high -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k ${outputMp4Arg}`,
    webm: `ffmpeg -i ${inputArg} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libvpx-vp9 -b:v 0 -crf 30 -row-mt 1 -c:a libopus -b:a 128k ${outputWebmArg}`,
  };
}

export async function sniffVideoCompatibilityHint(file: File): Promise<string | null> {
  if (file.size <= 0) {
    return null;
  }

  try {
    const maxBytes = Math.min(file.size, MAX_SNIFF_BYTES);
    const chunk = await file.slice(0, maxBytes).arrayBuffer();
    const bytes = new Uint8Array(chunk);
    const hasLegacyCodecMarker = LEGACY_CODEC_MARKERS.some((marker) => containsAsciiToken(bytes, marker));
    const hasModernCodecMarker = MODERN_CODEC_MARKERS.some((marker) => containsAsciiToken(bytes, marker));
    const hasMpeg2SequenceHeader = containsBytePattern(bytes, MPEG2_SEQUENCE_HEADER);

    if ((hasLegacyCodecMarker || hasMpeg2SequenceHeader) && !hasModernCodecMarker) {
      return 'Detected legacy MPEG stream markers (for example mp4v or 0x000001B3). Modern browsers usually cannot decode this stream directly in HTML5 video.';
    }
  } catch (error) {
    console.warn('Failed to inspect video codec markers.', error);
    return null;
  }

  return null;
}

export function detectPanoramaMediaType(file: File): PanoramaMediaType | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }

  const ext = getFileExtension(file.name);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }

  return null;
}

export function isLikelyEquirectangular(
  width: number,
  height: number,
  // Allow moderate deviation because some exports include light vertical crop.
  tolerance = 0.22,
): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }

  const ratio = width / height;
  return Math.abs(ratio - 2) <= tolerance;
}

export function getEquirectangularValidationDecision(
  mediaType: PanoramaMediaType,
  looksLikePanorama: boolean,
): EquirectangularValidationDecision {
  if (looksLikePanorama) {
    return {
      allowLoad: true,
      level: 'ok',
      message: null,
    };
  }

  if (mediaType === 'video') {
    return {
      allowLoad: true,
      level: 'warning',
      message: 'This video is not close to 2:1 ratio or metadata could not be read. Loading will still be attempted.',
    };
  }

  return {
    allowLoad: false,
    level: 'error',
    message: 'This file does not look like a full equirectangular panorama (expected close to a 2:1 ratio).',
  };
}

export function getVideoDecodeErrorMessage(
  errorCode?: number | null,
  mimeType = 'video file',
): string {
  switch (errorCode) {
    case 1:
      return 'Video loading was interrupted before metadata was read. Please try again.';
    case 2:
      return `The browser could not read this ${mimeType}. ${VIDEO_TRANSCODE_TIP}`;
    case 3:
      return `The browser cannot decode this video codec/profile. ${VIDEO_TRANSCODE_TIP}`;
    case 4:
      return `This video format is not supported by your browser. ${VIDEO_TRANSCODE_TIP}`;
    default:
      return `Failed to decode this video in the current browser. ${VIDEO_TRANSCODE_TIP}`;
  }
}

export async function preflightVideoPlayback(sourceUrl: string, mimeType = ''): Promise<void> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.playsInline = true;
  video.muted = true;
  video.crossOrigin = 'anonymous';

  if (mimeType && typeof video.canPlayType === 'function' && video.canPlayType(mimeType) === '') {
    throw new Error(getVideoDecodeErrorMessage(4, mimeType));
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const settle = (cb: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cb();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      settle(() => reject(new Error(`Timed out while reading video metadata. ${VIDEO_TRANSCODE_TIP}`)));
    }, 8000);

    const onLoaded = () => {
      if (video.videoWidth <= 0) {
        onError();
        return;
      }

      cleanup();
      settle(resolve);
    };

    const onError = () => {
      const errorCode = video.error?.code;
      cleanup();
      settle(() => reject(new Error(getVideoDecodeErrorMessage(errorCode, mimeType || 'video file'))));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.remove();
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = sourceUrl;

    if (video.readyState >= 1 && video.videoWidth > 0) {
      onLoaded();
    }
  });
}

export function getVideoLoadFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return getVideoDecodeErrorMessage(undefined, 'video file');
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      cleanup();
      reject(new Error('Failed to read image dimensions'));
    };

    try {
      image.src = objectUrl;
    } catch {
      cleanup();
      reject(new Error('Failed to read image dimensions'));
    }
  });
}

async function readVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    video.onloadedmetadata = () => {
      cleanup();
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to read video dimensions'));
    };

    try {
      video.src = objectUrl;
    } catch {
      cleanup();
      reject(new Error('Failed to read video dimensions'));
    }
  });
}

export async function validateLikelyEquirectangular(
  file: File,
  mediaType: PanoramaMediaType,
): Promise<boolean> {
  try {
    const dimensions = mediaType === 'image'
      ? await readImageDimensions(file)
      : await readVideoDimensions(file);

    return isLikelyEquirectangular(dimensions.width, dimensions.height);
  } catch {
    return false;
  }
}

export class ObjectUrlStore {
  private readonly trackedUrls = new Set<string>();

  create(file: Blob): string {
    const url = URL.createObjectURL(file);
    this.trackedUrls.add(url);
    return url;
  }

  revoke(url: string | null | undefined): void {
    if (!url || !this.trackedUrls.has(url)) {
      return;
    }

    URL.revokeObjectURL(url);
    this.trackedUrls.delete(url);
  }

  revokeAll(): void {
    this.trackedUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.trackedUrls.clear();
  }
}