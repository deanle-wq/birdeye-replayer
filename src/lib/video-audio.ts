import type { SoundCue, SoundPack, TimedCue } from "./video-scene";

const SAMPLE_RATE = 48_000;

/**
 * Sound effects. Glass & Air uses the approved sweep and chime samples.
 * The clean pack is synthesised from oscillators and noise;
 * the meme pack swaps sells and $20K milestones for two sample files. Either
 * way the same code renders the live preview (AudioContext) and the exported
 * soundtrack (OfflineAudioContext), so what you hear is what the MP4 gets.
 */

export interface SoundSettings {
  enabled: boolean;
  pack: SoundPack;
  trades: boolean;
  milestones: boolean;
  outro: boolean;
}

export const SOUND_PACK_LABELS: Record<SoundPack, string> = { glass: "Glass & Air", clean: "Clean", meme: "Meme" };
export const DEFAULT_SOUND: SoundSettings = { enabled: true, pack: "glass", trades: true, milestones: false, outro: true };

export function cueAllowed(cue: SoundCue, settings: SoundSettings): boolean {
  if (!settings.enabled) return false;
  if (settings.pack === "glass" && (cue === "tick" || cue === "milestone" || cue === "bandos")) return false;
  if (cue === "buy" || cue === "sell") return settings.trades;
  if (cue === "milestone" || cue === "bandos") return settings.milestones;
  return settings.outro;
}

/** Approved Glass & Air and legacy meme samples; see THIRD_PARTY_NOTICES.md. */
export const SAMPLE_URLS = { kaching: "/sfx/kaching.mp3", bandos: "/sfx/bandos.m4a", sweep: "/sfx/glass-sweep.mp3", chime: "/sfx/glass-chime.mp3" } as const;
export type SampleBank = Partial<Record<keyof typeof SAMPLE_URLS, AudioBuffer>>;

const samplesPromises = new Map<SoundPack, Promise<SampleBank>>();
const samplesReady: Partial<Record<SoundPack, SampleBank>> = {};

/**
 * Decode each sampled pack once. AudioBuffers are not tied to the context
 * that decoded them, so the same buffers serve the live preview and exports.
 */
export function loadSamples(pack: SoundPack = "meme"): Promise<SampleBank> {
  if (pack === "clean") return Promise.resolve({});
  const held = samplesPromises.get(pack);
  if (held) return held;
  const promise = (async () => {
    if (typeof OfflineAudioContext === "undefined") return {};
    const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const urls = Object.entries(SAMPLE_URLS).filter(([name]) => pack === "glass" ? name === "sweep" || name === "chime" : name === "kaching" || name === "bandos");
    const entries = await Promise.all(urls.map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Sound sample unavailable");
        const raw = await response.arrayBuffer();
        return [name, await decoder.decodeAudioData(raw)] as const;
      } catch {
        return [name, undefined] as const;
      }
    }));
    const bank = Object.fromEntries(entries.filter(([, buffer]) => buffer)) as SampleBank;
    if (pack === "glass" && (!bank.sweep || !bank.chime)) throw new Error("Glass & Air could not load. Try Preview sound again or turn sound off.");
    samplesReady[pack] = bank;
    return bank;
  })().catch(error => { samplesPromises.delete(pack); throw error; });
  samplesPromises.set(pack, promise);
  return promise;
}


const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  const held = noiseBuffers.get(ctx);
  if (held) return held;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise keeps exports byte-stable between runs.
  let seed = 22_695_477;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    data[i] = (seed / 1_073_741_824) - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  options: { when: number; type: OscillatorType; from: number; to?: number; glide?: number; peak: number; attack?: number; decay: number },
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.005;
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, options.when);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, options.when + (options.glide ?? options.decay));
  gain.gain.setValueAtTime(0.0001, options.when);
  gain.gain.exponentialRampToValueAtTime(options.peak, options.when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, options.when + attack + options.decay);
  osc.connect(gain).connect(out);
  osc.start(options.when);
  osc.stop(options.when + attack + options.decay + 0.05);
}

function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  options: { when: number; filter: BiquadFilterType; frequency: number; q?: number; peak: number; decay: number },
): void {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noise(ctx);
  filter.type = options.filter;
  filter.frequency.setValueAtTime(options.frequency, options.when);
  filter.Q.value = options.q ?? 1;
  gain.gain.setValueAtTime(0.0001, options.when);
  gain.gain.exponentialRampToValueAtTime(options.peak, options.when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, options.when + options.decay);
  source.connect(filter).connect(gain).connect(out);
  source.start(options.when);
  source.stop(options.when + options.decay + 0.05);
}

const semitone = (root: number, steps: number) => root * 2 ** (steps / 12);

function sample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, when: number, level: number): void {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = level;
  source.connect(gain).connect(out);
  source.start(when);
}

export function playCue(ctx: BaseAudioContext, out: AudioNode, cue: TimedCue, when: number, samples?: SampleBank, pack: SoundPack = "clean"): void {
  if (pack === "glass") {
    const buffer = cue.cue === "buy" || cue.cue === "sell" ? samples?.sweep : cue.cue === "win" || cue.cue === "loss" ? samples?.chime : undefined;
    if (buffer) sample(ctx, out, buffer, when, cue.cue === "buy" || cue.cue === "sell" ? .24 : .34);
    return;
  }
  if (cue.cue === "sell" && samples?.kaching) {
    sample(ctx, out, samples.kaching, when, 0.55);
    return;
  }
  if (cue.cue === "bandos") {
    if (samples?.bandos) {
      sample(ctx, out, samples.bandos, when, 0.95);
      return;
    }
    playCue(ctx, out, { ...cue, cue: "milestone" }, when);
    return;
  }
  switch (cue.cue) {
    case "buy": {
      // A soft rising blip.
      tone(ctx, out, { when, type: "sine", from: 740, to: 1_110, glide: 0.07, peak: 0.26, decay: 0.17 });
      tone(ctx, out, { when, type: "sine", from: 1_480, to: 2_220, glide: 0.07, peak: 0.06, decay: 0.12 });
      return;
    }
    case "sell": {
      // A synthesised till: a bright click, then two bell notes.
      burst(ctx, out, { when, filter: "bandpass", frequency: 4_800, q: 1.4, peak: 0.16, decay: 0.05 });
      tone(ctx, out, { when: when + 0.02, type: "triangle", from: 1_318.5, peak: 0.2, decay: 0.42 });
      tone(ctx, out, { when: when + 0.1, type: "triangle", from: 1_975.5, peak: 0.18, decay: 0.62 });
      tone(ctx, out, { when: when + 0.1, type: "sine", from: 2_637, peak: 0.05, decay: 0.4 });
      return;
    }
    case "milestone": {
      // A four-note arpeggio that climbs one step per milestone.
      const root = semitone(523.25, Math.min(cue.step ?? 0, 5) * 2);
      [0, 4, 7, 12].forEach((steps, index) => {
        tone(ctx, out, { when: when + index * 0.065, type: "triangle", from: semitone(root, steps), peak: 0.13, decay: 0.38 });
      });
      return;
    }
    case "tick": {
      tone(ctx, out, { when, type: "triangle", from: 1_700 + (cue.step ?? 0) * 45, peak: 0.045, attack: 0.002, decay: 0.03 });
      return;
    }
    case "win": {
      // Meme pack: the result card lands on the voice line too.
      if (samples?.bandos) sample(ctx, out, samples.bandos, when + 0.12, 0.95);
      burst(ctx, out, { when, filter: "lowpass", frequency: 900, peak: 0.12, decay: 0.12 });
      [0, 4, 7, 12].forEach((steps) => {
        tone(ctx, out, { when, type: "triangle", from: semitone(523.25, steps), peak: 0.1, attack: 0.01, decay: 1.25 });
        tone(ctx, out, { when, type: "sine", from: semitone(1_046.5, steps), peak: 0.035, attack: 0.01, decay: 0.9 });
      });
      tone(ctx, out, { when: when + 0.16, type: "sine", from: 2_093, peak: 0.05, decay: 0.5 });
      tone(ctx, out, { when: when + 0.26, type: "sine", from: 3_136, peak: 0.04, decay: 0.45 });
      return;
    }
    case "loss": {
      burst(ctx, out, { when, filter: "lowpass", frequency: 220, peak: 0.2, decay: 0.18 });
      tone(ctx, out, { when, type: "sine", from: 233, to: 116.5, glide: 0.55, peak: 0.24, attack: 0.01, decay: 0.75 });
      return;
    }
  }
}

function masterChain(ctx: BaseAudioContext): AudioNode {
  const gain = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  gain.gain.value = 0.85;
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 6;
  gain.connect(limiter).connect(ctx.destination);
  return gain;
}

/** The clip's soundtrack, or null when nothing would play (no empty track). */
export async function renderSoundtrack(cues: TimedCue[], seconds: number, settings: SoundSettings): Promise<AudioBuffer | null> {
  const allowed = cues.filter((cue) => cueAllowed(cue.cue, settings) && cue.t < seconds);
  if (allowed.length === 0 || typeof OfflineAudioContext === "undefined") return null;
  const samples = settings.pack === "clean" ? undefined : await loadSamples(settings.pack);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const out = masterChain(ctx);
  for (const cue of allowed) playCue(ctx, out, cue, cue.t, samples, settings.pack);
  return ctx.startRendering();
}

/** Plays cues as the preview playhead crosses them. */
export class LiveCuePlayer {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;

  /** `onState` hears whether the browser is letting the preview make sound. */
  constructor(private readonly onState?: (running: boolean) => void) {}

  /**
   * Create or resume the audio context. Browsers only allow this after a user
   * gesture on the page, so call it on open (sticky activation covers Chrome)
   * and again on any click inside the editor (Safari wants the gesture itself).
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.out = masterChain(this.ctx);
      this.ctx.onstatechange = () => this.onState?.(this.ctx?.state === "running");
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    this.onState?.(this.ctx.state === "running");
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Cues in (from, to]. Seeks and loops (large or backward jumps) stay silent. */
  play(cues: TimedCue[], from: number, to: number, settings: SoundSettings): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out || ctx.state !== "running" || to <= from || to - from > 0.5) return;
    const samples = samplesReady[settings.pack];
    for (const cue of cues) {
      if (cue.t > from && cue.t <= to && cueAllowed(cue.cue, settings)) playCue(ctx, out, cue, ctx.currentTime + 0.01, samples, settings.pack);
    }
  }

  async audition(settings: SoundSettings): Promise<void> {
    this.unlock();
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) throw new Error("Sound preview is unavailable in this browser.");
    const samples = settings.pack === "clean" ? undefined : await loadSamples(settings.pack);
    if (ctx.state === "suspended") await ctx.resume();
    const start = ctx.currentTime + .03;
    for (const cue of [{ t: 0, cue: "buy" }, { t: 1.6, cue: "win" }] as TimedCue[]) {
      if (cueAllowed(cue.cue, settings)) playCue(ctx, out, cue, start + cue.t, samples, settings.pack);
    }
    await new Promise(resolve => setTimeout(resolve, 3800));
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.out = null;
  }
}
