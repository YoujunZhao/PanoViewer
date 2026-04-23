import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPanoramaMediaType, isLikelyEquirectangular, ObjectUrlStore } from './media-file';

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