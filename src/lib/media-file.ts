export type PanoramaMediaType = 'image' | 'video';

export type EquirectangularValidationDecision = {
  allowLoad: boolean;
  level: 'ok' | 'warning' | 'error';
  message: string | null;
};

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

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to read image dimensions'));
    };

    image.src = objectUrl;
  });
}

async function readVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to read video dimensions'));
    };

    video.src = objectUrl;
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