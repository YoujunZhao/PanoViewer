import { describe, expect, it } from 'vitest';
import { buildBrowserTranscodePlans } from './browser-transcode';

describe('buildBrowserTranscodePlans', () => {
  it('returns mp4 first and webm fallback second', () => {
    const plans = buildBrowserTranscodePlans('sample.mp4');

    expect(plans).toHaveLength(2);
    expect(plans[0].target).toBe('mp4');
    expect(plans[1].target).toBe('webm');
  });

  it('sanitizes output file names for browser generated files', () => {
    const plans = buildBrowserTranscodePlans('Castle Fortress 0_2k 1k.mp4');

    expect(plans[0].outputName).toBe('Castle_Fortress_0_2k_1k-browser-h264.mp4');
    expect(plans[1].outputName).toBe('Castle_Fortress_0_2k_1k-browser-vp9.webm');
  });

  it('falls back to panorama output stem when filename has no safe characters', () => {
    const plans = buildBrowserTranscodePlans('!@#$%^&*()');

    expect(plans[0].outputName).toBe('panorama-browser-h264.mp4');
    expect(plans[1].outputName).toBe('panorama-browser-vp9.webm');
  });

  it('includes codec arguments for both targets', () => {
    const plans = buildBrowserTranscodePlans('input.mp4');

    expect(plans[0].args).toContain('libx264');
    expect(plans[0].args).toContain('aac');
    expect(plans[1].args).toContain('libvpx-vp9');
    expect(plans[1].args).toContain('libopus');
  });
});
