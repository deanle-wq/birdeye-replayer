import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";
import { VIDEO_FORMATS, type VideoShape } from "./video-frame";

export { VIDEO_FORMATS, type VideoShape };

export const MIN_VIDEO_SECONDS = 5;
export const MAX_VIDEO_SECONDS = 300;
export const VIDEO_FPS = 30;
export const FRAME_RATES = [30, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

/** H.264 High at level 4.2: the lowest level whose throughput covers 1080p60. */
const AVC_1080P60 = "avc1.64002a";

export interface VideoEncoderChoice {
  ext: "mp4" | "webm";
  codec: VideoCodec;
  /** Null when the browser cannot encode audio for this container. */
  audio: AudioCodec | null;
  /** Highest frame rate this encoder accepted at 1080p. */
  maxFps: FrameRate;
}

function bitrateFor(width: number, height: number, fps: number): number {
  // ~8 Mbps at 1080p30 and ~12 Mbps at 1080p60: consecutive frames at 60 fps
  // differ less, so the second 30 frames cost about half as much again.
  return Math.round(width * height * fps * (fps > 30 ? 0.1 : 0.13));
}

async function supports60(codec: VideoCodec): Promise<boolean> {
  try {
    const config: VideoEncoderConfig = {
      codec: codec === "avc" ? AVC_1080P60 : codec === "vp9" ? "vp09.00.41.08" : "vp8",
      width: 1920,
      height: 1080,
      framerate: 60,
      bitrate: bitrateFor(1920, 1080, 60),
    };
    return Boolean((await VideoEncoder.isConfigSupported(config)).supported);
  } catch {
    return false;
  }
}

export async function findVideoEncoder(): Promise<VideoEncoderChoice | null> {
  if (typeof VideoEncoder === "undefined") return null;
  try {
    const size = { width: 1920, height: 1080 };
    const avc = await getFirstEncodableVideoCodec(["avc"], size);
    if (avc) {
      const audio = await getFirstEncodableAudioCodec(["aac"], { numberOfChannels: 2, sampleRate: 48_000 }).catch(() => null);
      return { ext: "mp4", codec: avc, audio, maxFps: (await supports60(avc)) ? 60 : 30 };
    }
    const web = await getFirstEncodableVideoCodec(["vp9", "vp8"], size);
    if (!web) return null;
    const audio = await getFirstEncodableAudioCodec(["opus"], { numberOfChannels: 2, sampleRate: 48_000 }).catch(() => null);
    return { ext: "webm", codec: web, audio, maxFps: (await supports60(web)) ? 60 : 30 };
  } catch {
    return null;
  }
}

/**
 * Frame-by-frame export: every frame is drawn for its exact timestamp, so the
 * file is smooth on any machine and exactly `seconds` long. The soundtrack is
 * rendered offline beforehand and muxed as one track.
 */
export async function encodeWalletVideo(options: {
  shape: VideoShape;
  encoder: VideoEncoderChoice;
  seconds: number;
  fps?: number;
  audio?: AudioBuffer | null;
  draw: (ctx: CanvasRenderingContext2D, seconds: number) => void;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<Blob> {
  if (!Number.isInteger(options.seconds) || options.seconds < MIN_VIDEO_SECONDS || options.seconds > MAX_VIDEO_SECONDS) {
    throw new Error(`Video length must be between ${MIN_VIDEO_SECONDS} and ${MAX_VIDEO_SECONDS} seconds.`);
  }
  const fps = Math.min(options.fps ?? VIDEO_FPS, options.encoder.maxFps);
  const frames = Math.round(options.seconds * fps);
  const { width, height } = VIDEO_FORMATS[options.shape];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas is unavailable in this browser");

  const format = options.encoder.ext === "mp4"
    ? new Mp4OutputFormat({ fastStart: "in-memory" })
    : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const video = new CanvasSource(canvas, {
    codec: options.encoder.codec,
    // Sharp on X and TikTok without a 30 MB file.
    quality: new Quality({ bitrate: bitrateFor(width, height, fps), bitrateMode: "variable" }),
    keyFrameInterval: 2,
    // The library picks the AVC level from frame size and bitrate only, which
    // lands 1080p60 on level 4 (a 30 fps level). Ask for 4.2 explicitly.
    ...(options.encoder.codec === "avc" && fps > 30 ? { fullCodecString: AVC_1080P60 } : {}),
  });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = options.audio && options.encoder.audio
    ? new AudioBufferSource({ codec: options.encoder.audio, quality: new Quality({ bitrate: 160_000 }) })
    : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  try {
    if (audio && options.audio) {
      await audio.add(options.audio);
      audio.close();
    }
    const duration = 1 / fps;
    for (let frame = 0; frame < frames; frame += 1) {
      if (options.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      options.draw(ctx, frame / fps);
      await video.add(frame * duration, duration);
      if (frame % fps === 0) options.onProgress?.(frame / frames);
    }
    video.close();
    await output.finalize();
    options.onProgress?.(1);
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  }

  if (!target.buffer) throw new Error("The browser encoder returned an empty file");
  return new Blob([target.buffer], { type: format.mimeType });
}

export function downloadVideo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
