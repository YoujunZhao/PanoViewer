import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export type BrowserTranscodeTarget = 'mp4' | 'webm';

export type BrowserTranscodePlan = {
  target: BrowserTranscodeTarget;
  outputName: string;
  mimeType: string;
  args: string[];
};

export type BrowserTranscodeProgress = {
  stage: 'loading-core' | 'writing-input' | 'encoding' | 'reading-output';
  message: string;
  target?: BrowserTranscodeTarget;
  progress?: number;
};

export type BrowserTranscodeResult = {
  file: File;
  target: BrowserTranscodeTarget;
};

const INPUT_NAME = 'browser-input.mp4';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

export function unloadBrowserTranscoder(): void {
  if (!ffmpegInstance) {
    return;
  }

  ffmpegInstance.terminate();
  ffmpegInstance = null;
  ffmpegLoadPromise = null;
}

function toSafeOutputStem(fileName: string): string {
  const trimmed = fileName.trim();
  const fileStem = trimmed.replace(/\.[^./\\]+$/, '');
  const safe = fileStem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return safe || 'panorama';
}

export function buildBrowserTranscodePlans(fileName: string): BrowserTranscodePlan[] {
  const safeStem = toSafeOutputStem(fileName);

  const plans: BrowserTranscodePlan[] = [
    {
      target: 'mp4',
      outputName: `${safeStem}-browser-h264.mp4`,
      mimeType: 'video/mp4',
      args: [
        '-i',
        INPUT_NAME,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        `${safeStem}-browser-h264.mp4`,
      ],
    },
    {
      target: 'webm',
      outputName: `${safeStem}-browser-vp9.webm`,
      mimeType: 'video/webm',
      args: [
        '-i',
        INPUT_NAME,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '0',
        '-crf',
        '32',
        '-row-mt',
        '1',
        '-c:a',
        'libopus',
        '-b:a',
        '96k',
        `${safeStem}-browser-vp9.webm`,
      ],
    },
  ];

  return plans;
}

async function getFFmpeg(onProgress?: (progress: BrowserTranscodeProgress) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance;
  }

  if (ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    onProgress?.({
      stage: 'loading-core',
      message: 'Loading browser transcoder core. The first run may download around 25MB.',
    });
    await ffmpeg.load();
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } finally {
    ffmpegLoadPromise = null;
  }
}

async function safeDeleteFile(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Ignore cleanup errors from missing files.
  }
}

export async function transcodeVideoInBrowser(
  sourceFile: File,
  onProgress?: (progress: BrowserTranscodeProgress) => void,
): Promise<BrowserTranscodeResult> {
  if (!(sourceFile instanceof File)) {
    throw new TypeError('Browser transcoding expects a File object.');
  }

  if (sourceFile.size <= 0) {
    throw new Error('Uploaded video is empty and cannot be transcoded.');
  }

  const ffmpeg = await getFFmpeg(onProgress);
  const plans = buildBrowserTranscodePlans(sourceFile.name);

  onProgress?.({
    stage: 'writing-input',
    message: 'Copying uploaded video into the browser transcoder memory...',
  });

  await safeDeleteFile(ffmpeg, INPUT_NAME);
  await ffmpeg.writeFile(INPUT_NAME, await fetchFile(sourceFile));

  const failures: string[] = [];

  for (const plan of plans) {
    const handleProgress = ({ progress }: { progress: number }) => {
      onProgress?.({
        stage: 'encoding',
        target: plan.target,
        progress,
        message: `Encoding ${plan.target.toUpperCase()} in browser...`,
      });
    };

    ffmpeg.on('progress', handleProgress);

    try {
      await safeDeleteFile(ffmpeg, plan.outputName);
      const exitCode = await ffmpeg.exec(plan.args);
      if (exitCode !== 0) {
        failures.push(`${plan.target}: exit code ${exitCode}`);
        continue;
      }

      onProgress?.({
        stage: 'reading-output',
        target: plan.target,
        message: `Reading transcoded ${plan.target.toUpperCase()} output...`,
      });

      const output = await ffmpeg.readFile(plan.outputName);
      if (!(output instanceof Uint8Array)) {
        failures.push(`${plan.target}: unexpected ffmpeg output type`);
        continue;
      }

      const outputBytes = new Uint8Array(output);

      const convertedFile = new File(
        [outputBytes],
        plan.outputName,
        {
          type: plan.mimeType,
          lastModified: Date.now(),
        },
      );

      await safeDeleteFile(ffmpeg, plan.outputName);
      await safeDeleteFile(ffmpeg, INPUT_NAME);

      return {
        file: convertedFile,
        target: plan.target,
      };
    } catch (error) {
      failures.push(`${plan.target}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ffmpeg.off('progress', handleProgress);
      await safeDeleteFile(ffmpeg, plan.outputName);
    }
  }

  await safeDeleteFile(ffmpeg, INPUT_NAME);
  throw new Error(`Browser transcoding failed. ${failures.join(' | ')}`);
}
