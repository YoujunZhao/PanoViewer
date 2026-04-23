import { Viewer } from '@photo-sphere-viewer/core';
import { EquirectangularVideoAdapter } from '@photo-sphere-viewer/equirectangular-video-adapter';
import { VideoPlugin } from '@photo-sphere-viewer/video-plugin';

export type ViewerMode = 'image' | 'video';

export class PanoramaViewerController {
  private readonly container: HTMLElement;
  private viewer: Viewer | null = null;
  private mode: ViewerMode | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  get currentMode(): ViewerMode | null {
    return this.mode;
  }

  async loadImage(source: string): Promise<void> {
    await this.replaceViewer(
      () => new Viewer({
        container: this.container,
        navbar: ['zoom', 'move', 'fullscreen'],
        mousewheelCtrlKey: false,
        touchmoveTwoFingers: false,
      }),
      'image',
      source,
    );
  }

  async loadVideo(source: string): Promise<void> {
    await this.replaceViewer(
      () => new Viewer({
        container: this.container,
        adapter: EquirectangularVideoAdapter,
        plugins: [
          VideoPlugin.withConfig({
            progressbar: true,
            bigbutton: true,
          }),
        ],
        navbar: ['zoom', 'move', 'videoPlay', 'videoVolume', 'videoTime', 'fullscreen'],
        mousewheelCtrlKey: false,
        touchmoveTwoFingers: false,
      }),
      'video',
      { source },
    );
  }

  toggleFullscreen(): boolean {
    if (!this.viewer) {
      return false;
    }

    this.viewer.toggleFullscreen();
    return true;
  }

  clear(): void {
    this.viewer?.destroy();
    this.viewer = null;
    this.mode = null;
  }

  destroy(): void {
    this.clear();
  }

  private async replaceViewer(nextViewerFactory: () => Viewer, mode: ViewerMode, panorama: unknown): Promise<void> {
    this.viewer?.destroy();

    const nextViewer = nextViewerFactory();
    this.viewer = nextViewer;
    this.mode = mode;

    try {
      const loaded = await nextViewer.setPanorama(panorama);
      if (!loaded) {
        throw new Error('Panorama loading was interrupted');
      }
    } catch (error) {
      nextViewer.destroy();
      if (this.viewer === nextViewer) {
        this.viewer = null;
        this.mode = null;
      }
      throw error;
    }
  }
}