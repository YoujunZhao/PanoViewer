import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPanoramaMediaType,
  getEquirectangularValidationDecision,
  isLikelyEquirectangular,
  ObjectUrlStore,
  validateLikelyEquirectangular,
} from './media-file';

describe('detectPanoramaMediaType', () => {
  it('detects image files by MIME type', () => {
    const file = new File(['img'], 'pano.unknown', { type: 'image/jpeg' });

    expect(detectPanoramaMediaType(file)).toBe('image');
  });

  it('detects video files by extension when MIME type is missing', () => {
    const file = new File(['video'], 'street-view.mp4', { type: '' });

    expect(detectPanoramaMediaType(file)).toBe('video');
  });

  it('returns null for unsupported file formats', () => {
    const file = new File(['raw'], 'notes.txt', { type: 'text/plain' });

    expect(detectPanoramaMediaType(file)).toBeNull();
  });
});

describe('isLikelyEquirectangular', () => {
  it('accepts exact 2:1 dimensions', () => {
    expect(isLikelyEquirectangular(6000, 3000)).toBe(true);
  });

  it('accepts dimensions within tolerance', () => {
    expect(isLikelyEquirectangular(3840, 2000)).toBe(true);
  });

  it('rejects non-panorama ratios', () => {
    expect(isLikelyEquirectangular(1920, 1080)).toBe(false);
  });
});

describe('getEquirectangularValidationDecision', () => {
  it('blocks non-equirectangular images', () => {
    const decision = getEquirectangularValidationDecision('image', false);

    expect(decision.allowLoad).toBe(false);
    expect(decision.level).toBe('error');
  });

  it('allows non-equirectangular videos with warning', () => {
    const decision = getEquirectangularValidationDecision('video', false);

    expect(decision.allowLoad).toBe(true);
    expect(decision.level).toBe('warning');
    expect(decision.message).toContain('Loading will still be attempted');
  });

  it('allows likely equirectangular files', () => {
    const decision = getEquirectangularValidationDecision('video', true);

    expect(decision.allowLoad).toBe(true);
    expect(decision.level).toBe('ok');
    expect(decision.message).toBeNull();
  });
});

describe('validateLikelyEquirectangular', () => {
  it('returns false when image metadata cannot be read', async () => {
    const originalImage = globalThis.Image;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onerror?.();
      }
    }

    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      writable: true,
      value: FailingImage,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:test-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    const file = new File(['image'], 'broken.jpg', { type: 'image/jpeg' });
    await expect(validateLikelyEquirectangular(file, 'image')).resolves.toBe(false);

    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      writable: true,
      value: originalImage,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });

  it('returns true when video metadata indicates a 2:1 ratio', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') {
        return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
      }

      const fakeVideo = {
        preload: '',
        videoWidth: 4000,
        videoHeight: 2000,
        onloadedmetadata: null as (() => void) | null,
        onerror: null as (() => void) | null,
        set src(_value: string) {
          this.onloadedmetadata?.();
        },
      };

      return fakeVideo as unknown as HTMLElement;
    }) as typeof document.createElement);

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:test-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    const file = new File(['video'], 'street.mp4', { type: 'video/mp4' });
    await expect(validateLikelyEquirectangular(file, 'video')).resolves.toBe(true);

    createElementSpy.mockRestore();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });
});

describe('ObjectUrlStore', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn((file: Blob) => `blob:${file.size}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });

  it('creates and revokes tracked object URLs', () => {
    const store = new ObjectUrlStore();
    const url = store.create(new Blob(['abc']));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    store.revoke(url);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('releases all tracked URLs', () => {
    const store = new ObjectUrlStore();
    const urlA = store.create(new Blob(['a']));
    const urlB = store.create(new Blob(['b']));

    store.revokeAll();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urlA);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urlB);
  });
});