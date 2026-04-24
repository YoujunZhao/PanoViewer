import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVideoTranscodeCommands,
  detectPanoramaMediaType,
  getEquirectangularValidationDecision,
  getVideoDecodeErrorMessage,
  isLikelyEquirectangular,
  ObjectUrlStore,
  preflightVideoPlayback,
  sniffVideoCompatibilityHint,
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

describe('getVideoDecodeErrorMessage', () => {
  it('returns actionable message for unsupported source errors', () => {
    const message = getVideoDecodeErrorMessage(4, 'video/mp4');

    expect(message).toContain('not supported');
    expect(message).toContain('H.264');
  });

  it('returns actionable message for decode errors', () => {
    const message = getVideoDecodeErrorMessage(3, 'video/mp4');

    expect(message).toContain('decode this video');
    expect(message).toContain('VP9');
  });
});

describe('buildVideoTranscodeCommands', () => {
  it('builds safe ffmpeg commands from the uploaded file name', () => {
    const commands = buildVideoTranscodeCommands('Castle Fortress 0_2k 1k.mp4');

    expect(commands.mp4).toContain('ffmpeg -i "Castle Fortress 0_2k 1k.mp4"');
    expect(commands.mp4).toContain('"Castle_Fortress_0_2k_1k-h264.mp4"');
    expect(commands.webm).toContain('"Castle_Fortress_0_2k_1k-vp9.webm"');
  });

  it('falls back to a safe output name when filename has no safe characters', () => {
    const commands = buildVideoTranscodeCommands('!@#$%^&*()');

    expect(commands.mp4).toContain('ffmpeg -i "!@#\\$%^&*()"');
    expect(commands.mp4).toContain('"panorama-h264.mp4"');
  });

  it('escapes shell-sensitive characters in the input path', () => {
    const commands = buildVideoTranscodeCommands('danger`$".mp4');

    expect(commands.mp4).toContain('ffmpeg -i "danger');
    expect(commands.mp4).toContain('\\`');
    expect(commands.mp4).toContain('\\$');
    expect(commands.mp4).toContain('\\".mp4"');
  });
});

describe('sniffVideoCompatibilityHint', () => {
  it('flags legacy MPEG stream signatures', async () => {
    const bytes = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x1c,
      0x66,
      0x74,
      0x79,
      0x70,
      0x69,
      0x73,
      0x6f,
      0x6d,
      0x00,
      0x00,
      0x01,
      0xb3,
    ]);
    const file = new File([bytes], 'legacy.mp4', { type: 'video/mp4' });

    await expect(sniffVideoCompatibilityHint(file)).resolves.toContain('legacy MPEG stream markers');
  });

  it('returns null when modern codec markers are present', async () => {
    const bytes = new TextEncoder().encode('....avc1....');
    const file = new File([bytes], 'modern.mp4', { type: 'video/mp4' });

    await expect(sniffVideoCompatibilityHint(file)).resolves.toBeNull();
  });
});

describe('preflightVideoPlayback', () => {
  it('resolves when metadata can be loaded', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const removedEvents: string[] = [];
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') {
        return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
      }

      const listeners: Record<string, (() => void) | undefined> = {};
      const fakeVideo = {
        preload: '',
        playsInline: false,
        muted: false,
        crossOrigin: '',
        readyState: 0,
        videoWidth: 0,
        canPlayType() {
          return 'maybe';
        },
        addEventListener(event: string, callback: () => void) {
          listeners[event] = callback;
        },
        removeEventListener(event: string) {
          removedEvents.push(event);
          delete listeners[event];
        },
        remove() {},
        set src(_value: string) {
          this.readyState = 1;
          this.videoWidth = 4000;
          listeners.loadedmetadata?.();
        },
      };

      return fakeVideo as unknown as HTMLElement;
    }) as typeof document.createElement);

    await expect(preflightVideoPlayback('blob:test', 'video/mp4')).resolves.toBeUndefined();
    expect(removedEvents).toContain('loadedmetadata');
    expect(removedEvents).toContain('error');

    createElementSpy.mockRestore();
  });

  it('rejects when video metadata fails to load', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') {
        return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
      }

      const listeners: Record<string, (() => void) | undefined> = {};
      const fakeVideo = {
        preload: '',
        playsInline: false,
        muted: false,
        crossOrigin: '',
        readyState: 0,
        videoWidth: 0,
        canPlayType() {
          return 'maybe';
        },
        error: {
          code: 3,
        },
        addEventListener(event: string, callback: () => void) {
          listeners[event] = callback;
        },
        removeEventListener(event: string) {
          delete listeners[event];
        },
        remove() {},
        set src(_value: string) {
          listeners.error?.();
        },
      };

      return fakeVideo as unknown as HTMLElement;
    }) as typeof document.createElement);

    await expect(preflightVideoPlayback('blob:test', 'video/mp4')).rejects.toThrow('decode this video');

    createElementSpy.mockRestore();
  });

  it('rejects early when browser cannot play the mime type', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') {
        return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
      }

      const fakeVideo = {
        preload: '',
        playsInline: false,
        muted: false,
        crossOrigin: '',
        readyState: 0,
        videoWidth: 0,
        canPlayType() {
          return '';
        },
        addEventListener() {},
        removeEventListener() {},
        remove() {},
        set src(_value: string) {},
      };

      return fakeVideo as unknown as HTMLElement;
    }) as typeof document.createElement);

    await expect(preflightVideoPlayback('blob:test', 'video/mp4')).rejects.toThrow('not supported');

    createElementSpy.mockRestore();
  });

  it('rejects on metadata timeout', async () => {
    vi.useFakeTimers();

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'video') {
        return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
      }

      const fakeVideo = {
        preload: '',
        playsInline: false,
        muted: false,
        crossOrigin: '',
        readyState: 0,
        videoWidth: 0,
        canPlayType() {
          return 'maybe';
        },
        addEventListener() {},
        removeEventListener() {},
        remove() {},
        set src(_value: string) {},
      };

      return fakeVideo as unknown as HTMLElement;
    }) as typeof document.createElement);

    const promise = preflightVideoPlayback('blob:test', 'video/mp4');
    const assertion = expect(promise).rejects.toThrow('Timed out while reading video metadata');
    await vi.advanceTimersByTimeAsync(8001);
    await assertion;

    createElementSpy.mockRestore();
    vi.useRealTimers();
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