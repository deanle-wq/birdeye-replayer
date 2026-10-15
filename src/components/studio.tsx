"use client";

import { FeatureSwitch, ProductBrand } from "@/components/product-brand";
import { useTheme } from "@/lib/use-theme";
import {
  ArrowRight, ArrowsClockwise, CaretDown, ChartLineUp, Check, CircleNotch,
  DownloadSimple, FilmStrip, Info, Key, Moon, Pause, Play, Scissors,
  SkipBack, SlidersHorizontal, Sparkle, SpeakerHigh, SpeakerSlash, Sun, Tag,
} from "@phosphor-icons/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LayerIcon, LAYER_DESCRIPTIONS, Segmented, SwitchField, TokenForm } from "./studio-controls";
import { apiFetch, setVisitorApiKey, visitorApiKey } from "@/lib/api-client";
import { sameLookup } from "@/lib/lookup-state";
import { drawChartFrame, drawMessage, type ChartAxis, type ChartScene, type ChartStyle } from "@/lib/chart-frame";
import { barTime, compactUsd, cueSchedule, tagBursts, videoTimeline } from "@/lib/chart-scene";
import { binTagEvents, DENSITY_LIMIT, LAYER_INFO, selectEvents, TAG_LAYERS, type Density, type TagEvent, type TagLayer } from "@/lib/chart-tags";
import { autoTimeframe, formatMoment, formatSpan, fromInputValue, matchPreset, moveEdge, PRESET_LABEL, presetRange, presetRepeatsFull, RANGE_PRESETS, snapRange, targetCandles, timeframeAllowed, toInputValue, type RangePreset, type TimeRange } from "@/lib/range";
import { REPLAY_TIMEFRAMES, TIMEFRAME_SECONDS, type ReplayTimeframe } from "@/lib/replay-timeframe";
import { loadTokenLogo } from "@/lib/token-logo";
import { DEFAULT_SOUND, SOUND_PACK_LABELS, LiveCuePlayer, loadSamples, renderSoundtrack, type SoundSettings } from "@/lib/video-audio";
import {
  encodeVideo,
  findVideoEncoder,
  FRAME_RATES,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_FORMATS,
  type FrameRate,
  type VideoEncoderChoice,
  type VideoShape,
} from "@/lib/video-encoder";
import type { BirdeyeCandle } from "@/server/birdeye/types";
import type { ApiUsage } from "@/server/birdeye/usage";
import type { TokenChart } from "@/server/services/token-chart";
import { FONT_FAMILY } from "@/lib/design-system";
import type { VideoTheme } from "@/lib/frame-kit";
import { VIDEO_BACKGROUNDS, videoBackground, type VideoBackgroundId } from "@/lib/video-background";
import { loadVideoIcons, type VideoIcons } from "@/lib/video-icons";
import { RangePicker } from "./range-picker";
import { short, TokenAvatar, UsagePanel } from "./shared";

const LOGO_SRC = "/brand/logos/Birdeye_Data_Horizontal_Light.svg";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CLIP_DURATIONS = [6, 10, 15, 30, 60] as const;
const INTERVAL_LABEL: Record<ReplayTimeframe, string> = {
  "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
  "1H": "1 hour", "4H": "4 hours", "1D": "1 day", "1W": "1 week",
};
const BIG_SIZES = ["auto", 1_000, 5_000, 10_000, 50_000, 100_000, 500_000] as const;
type BigSize = (typeof BIG_SIZES)[number];



interface TagState {
  key: string;
  events: TagEvent[];
  notes: string[];
  trackerFrame?: string;
  bigThresholdUsd?: number;
  usage?: ApiUsage;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function readLocation(): { mint: string; range?: TimeRange } | null {
  const params = new URLSearchParams(window.location.search);
  const mint = params.get("mint")?.trim();
  if (!mint || !SOLANA_ADDRESS.test(mint)) return null;
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  return { mint, range: Number.isSafeInteger(from) && Number.isSafeInteger(to) && to > from ? { from, to } : undefined };
}

export function Studio() {
  const [theme, setTheme] = useTheme();
  const [activePanel, setActivePanel] = useState("window");
  const [toolOrientation, setToolOrientation] = useState<"horizontal" | "vertical">("vertical");
  const [keyOpen, setKeyOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [exportError, setExportError] = useState("");
  // Starts from the key typed in the other feature: one key per tab.
  const [apiKey, setApiKey] = useState(visitorApiKey);
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const [mintInput, setMintInput] = useState("");
  const [error, setError] = useState("");
  const [chart, setChart] = useState<TokenChart | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [draft, setDraft] = useState<TimeRange | null>(null);
  const [timeframeChoice, setTimeframeChoice] = useState<ReplayTimeframe | null>(null);
  const [candleState, setCandleState] = useState<{ key: string; candles: BirdeyeCandle[] } | null>(null);
  const [candleError, setCandleError] = useState("");
  const [layers, setLayers] = useState<Set<TagLayer>>(() => new Set<TagLayer>(["big", "smart_trader", "kol"]));
  const [bigSize, setBigSize] = useState<BigSize>("auto");
  const [names, setNames] = useState(true);
  const [density, setDensity] = useState<Density>("normal");
  const [tagState, setTagState] = useState<TagState | null>(null);
  const [tagError, setTagError] = useState("");
  const [shape, setShape] = useState<VideoShape>("feed");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [videoTheme, setVideoTheme] = useState<VideoTheme>("dark");
  const [backgroundChoice, setBackgroundChoice] = useState<VideoBackgroundId>("brand");
  const [customBackgroundColor, setCustomBackgroundColor] = useState("#C8D8CC");
  const [clipSeconds, setClipSeconds] = useState(15);
  const [fpsChoice, setFpsChoice] = useState<FrameRate>(60);
  const [axisChoice, setAxisChoice] = useState<ChartAxis>("price");
  const [effectsOn, setEffectsOn] = useState(true);
  const [markersOn, setMarkersOn] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(1.1);
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [encoder, setEncoder] = useState<VideoEncoderChoice | null | "probing">("probing");
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [generated, setGenerated] = useState<{ url: string; name: string; key: string } | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [lightLogo, setLightLogo] = useState<HTMLImageElement | null>(null);
  const [tokenLogo, setTokenLogo] = useState<HTMLImageElement | null>(null);
  const [videoIcons, setVideoIcons] = useState<VideoIcons>({ light: {}, dark: {} });
  const [fontsReady, setFontsReady] = useState(false);
  const [audioRunning, setAudioRunning] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [previewingSound, setPreviewingSound] = useState(false);
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasNode(node);
  }, []);
  const playheadRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<LiveCuePlayer | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const bootedRef = useRef(false);
  // Guards against a slow earlier token load landing after a newer one.
  const loadRequestRef = useRef(0);
  // Bumped by "Try again" so a failed candle or tag request runs once more.
  const [retryNonce, setRetryNonce] = useState(0);
  // The preset last clicked: on a young token several presets give the same range.
  const [pickedPreset, setPickedPreset] = useState<RangePreset | null>(null);


  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setToolOrientation(query.matches ? "horizontal" : "vertical");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const demo = Boolean(chart?.demo);
  const mint = chart?.token.mint ?? "";
  const needsKey = serverKey === false && apiKey.trim() === "";
  const timeline = useMemo(() => videoTimeline(clipSeconds), [clipSeconds]);

  // ── Load a token ───────────────────────────────────────────────────────
  const loadToken = useCallback(async (target: string, options: { demo?: boolean; range?: TimeRange } = {}) => {
    setError("");
    const value = target.trim();
    if (!options.demo && !SOLANA_ADDRESS.test(value)) {
      setError("Paste a Solana token mint: base58, 32–44 characters.");
      return;
    }
    const request = ++loadRequestRef.current;
    setLoadingChart(true);
    setPlaying(false);
    try {
      const response = await apiFetch(options.demo ? "/api/chart/token?demo=1" : `/api/chart/token?mint=${encodeURIComponent(value)}`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) setKeyOpen(true);
        throw new Error(body.error ?? "Token lookup failed");
      }
      if (request !== loadRequestRef.current) return;
      const next = body as TokenChart;
      setChart(next);
      setSourceOpen(false);
      setActivePanel("window");
      if (!next.demo) setMintInput(next.token.mint);
      setCandleState(null);
      setTagState(null);
      setTimeframeChoice(null);
      setGenerated(null);
      const young = next.bounds.to - next.bounds.from < 8 * 86_400;
      const initial: RangePreset = young ? "full" : "7d";
      setPickedPreset(options.range ? null : initial);
      setRange(options.range ?? presetRange(initial, next.bounds, next.history));
      setDraft(null);
      playheadRef.current = 0;
      setPlayhead(0);

    } catch (caught) {
      if (request === loadRequestRef.current) setError(caught instanceof Error ? caught.message : "Token lookup failed");
    } finally {
      if (request === loadRequestRef.current) setLoadingChart(false);
    }
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((health) => {
        const configured = Boolean(health.configured);
        setServerKey(configured);
        const target = readLocation();
        if (!target) return;
        setMintInput(target.mint);
        if (!configured) {
          setError("Add your Birdeye Data API key, then press Load to open this link.");
          return;
        }
        void loadToken(target.mint, { range: target.range });
      })
      .catch(() => setServerKey(false));
  }, [loadToken]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (loadingChart || alreadyLoaded) return;
    if (!SOLANA_ADDRESS.test(mintInput.trim())) {
      setError("Paste a valid Solana token mint address.");
      return;
    }
    if (needsKey) {
      setError("Add your Birdeye Data API key first. It stays in this tab's memory only.");
      setKeyOpen(true);
      return;
    }
    void loadToken(mintInput);
  }

  // ── Window and candles ─────────────────────────────────────────────────
  const shownRange = draft ?? range;
  const activePreset = chart && shownRange ? matchPreset(shownRange, chart.bounds, chart.history, pickedPreset) : undefined;
  const timeframe: ReplayTimeframe = range
    ? timeframeChoice && timeframeAllowed(range, timeframeChoice) ? timeframeChoice : autoTimeframe(range, targetCandles(clipSeconds))
    : "1H";
  const frame = useMemo(() => (range ? snapRange(range, timeframe) : null), [range, timeframe]);
  const candleKey = frame && mint ? `${mint}:${frame.from}:${frame.to}:${timeframe}` : null;
  const candles = candleState && candleState.key === candleKey ? candleState.candles : null;
  const loadingCandles = Boolean(candleKey && !candles && !candleError);

  useEffect(() => {
    if (!candleKey || !frame || candleState?.key === candleKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ mint, from: String(frame.from), to: String(frame.to), timeframe });
      if (demo) params.set("demo", "1");
      setCandleError("");
      void apiFetch(`/api/ohlcv?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "OHLCV request failed");
          if (cancelled) return;
          const list = (body.candles ?? []) as BirdeyeCandle[];
          if (list.length < 2) throw new Error(`Birdeye returned too few ${timeframe} candles for this window.`);
          setCandleState({ key: candleKey, candles: list });
          setGenerated(null);
        })
        .catch((caught) => {
          if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
          setCandleError(caught instanceof Error ? caught.message : "OHLCV request failed");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [candleKey, candleState?.key, demo, frame, mint, retryNonce, timeframe]);

  // Keep the address bar on the current token and window, for sharing.
  useEffect(() => {
    if (!chart || demo || !range) return;
    const url = new URL(globalThis.location.href);
    url.search = new URLSearchParams({ mint, from: String(range.from), to: String(range.to) }).toString();
    if (url.toString() !== globalThis.location.href) globalThis.history.replaceState(null, "", url);
  }, [chart, demo, mint, range]);

  // ── Tag layers ─────────────────────────────────────────────────────────
  const volumeUsd = useMemo(() => (candles ?? []).reduce((sum, candle) => sum + (candle.v_usd ?? candle.v * candle.c), 0), [candles]);
  const layerList = useMemo(() => TAG_LAYERS.filter((layer) => layers.has(layer)), [layers]);
  const tagKey = candleKey && candles && layerList.length > 0 ? `${candleKey}:${layerList.join(",")}:${bigSize}:${names ? 1 : 0}` : null;
  const loadingTags = Boolean(tagKey && tagState?.key !== tagKey && !tagError);

  useEffect(() => {
    if (!tagKey || !frame || tagState?.key === tagKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ mint, from: String(frame.from), to: String(frame.to), timeframe, layers: layerList.join(","), volume: String(Math.round(volumeUsd)) });
      if (bigSize !== "auto") params.set("minUsd", String(bigSize));
      if (names) params.set("names", "1");
      if (demo) params.set("demo", "1");
      setTagError("");
      void apiFetch(`/api/chart/tags?${params}`)
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Tag lookup failed");
          if (!cancelled) setTagState({ key: tagKey, ...body });
          setGenerated(null);
        })
        .catch((caught) => {
          if (!cancelled) setTagError(caught instanceof Error ? caught.message : "Tag lookup failed");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bigSize, demo, frame, layerList, mint, names, retryNonce, tagKey, tagState?.key, timeframe, volumeUsd]);

  const tagEvents = useMemo(() => (tagState && tagKey && tagState.key === tagKey ? tagState.events : []), [tagKey, tagState]);
  const selected = useMemo(() => selectEvents(tagEvents, layers, density), [density, layers, tagEvents]);
  const binned = useMemo(() => binTagEvents(selected, candles ?? [], TIMEFRAME_SECONDS[timeframe]), [candles, selected, timeframe]);
  const barEvents = useMemo(() => new Map(binned.bars.map((entry) => [entry.bar, entry.events])), [binned]);
  const bursts = useMemo(() => tagBursts(binned.bars, candles?.length ?? 0, timeline.replaySeconds), [binned, candles, timeline.replaySeconds]);
  const change = useMemo(() => {
    if (!candles || candles.length < 2) return [];
    const start = candles[0]!.o || candles[0]!.c;
    const stride = Math.max(1, Math.floor(candles.length / 90));
    const points: Array<{ t: number; pct: number }> = [];
    for (let i = 0; i < candles.length; i += stride) points.push({ t: barTime(i, candles.length, timeline.replaySeconds), pct: candles[i]!.c / start - 1 });
    return points;
  }, [candles, timeline.replaySeconds]);
  const finalPct = candles && candles.length > 1 ? candles.at(-1)!.c / (candles[0]!.o || candles[0]!.c) - 1 : 0;
  const cues = useMemo(() => (candles ? cueSchedule({ bursts, change, timeline, finalPct, pack: sound.pack }) : []), [bursts, candles, change, finalPct, sound.pack, timeline]);

  // ── Assets, audio, encoder ─────────────────────────────────────────────
  useEffect(() => {
    const image = new Image();
    image.onload = () => setLogo(image);
    image.src = LOGO_SRC;
    const lightImage = new Image();
    lightImage.onload = () => setLightLogo(lightImage);
    lightImage.src = "/brand/logos/Birdeye_Data_Horizontal_Dark.svg";
    let cancelled = false;
    void Promise.all([
      ...["400", "500", "600", "700", "800"].map((weight) => document.fonts.load(`${weight} 48px ${FONT_FAMILY}`).catch(() => document.fonts.load(`${weight} 48px Geist`))),
      loadVideoIcons().then((icons) => { if (!cancelled) setVideoIcons(icons); }),
    ]).then(() => {
      if (!cancelled) setFontsReady(true);
    }).catch(() => { if (!cancelled) setExportError("Video assets could not load. Reload the studio and try again."); });
    void findVideoEncoder().then((choice) => {
      if (!cancelled) setEncoder(choice);
    });
    const player = new LiveCuePlayer(setAudioRunning);
    audioRef.current = player;
    return () => {
      cancelled = true;
      image.onload = null;
      lightImage.onload = null;
      player.close();
      if (audioRef.current === player) audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTokenLogo(chart?.token.logo).then((image) => {
      if (!cancelled) setTokenLogo(image);
    });
    return () => {
      cancelled = true;
    };
  }, [chart?.token.logo]);

  useEffect(() => {
    let cancelled = false;
    if (sound.pack !== "clean") void loadSamples(sound.pack).catch(error => {
      if (!cancelled) setSoundError(error instanceof Error ? error.message : "Sound could not load.");
    });
    return () => { cancelled = true; };
  }, [sound.pack]);

  useEffect(() => () => {
    if (generated) URL.revokeObjectURL(generated.url);
  }, [generated]);

  const supplyKnown = (chart?.market?.circulatingSupply ?? 0) > 0;
  const axis: ChartAxis = supplyKnown ? axisChoice : "price";
  const fps: FrameRate = encoder && encoder !== "probing" ? (Math.min(fpsChoice, encoder.maxFps) as FrameRate) : fpsChoice;

  const scene = useMemo<ChartScene | null>(() => (chart && candles && range ? {
    shape,
    chartStyle,
    videoTheme,
    videoBackground: backgroundChoice,
    customBackgroundColor,
    symbol: chart.token.symbol ?? "TOKEN",
    name: chart.token.name?.trim() && chart.token.name.trim().toLowerCase() !== (chart.token.symbol ?? "").toLowerCase() ? chart.token.name.trim() : undefined,
    tokenLogo,
    logo: videoTheme === "light" ? lightLogo : logo,
    icons: videoIcons,
    demo,
    candles,
    rangeLabel: `${formatSpan(range.to - range.from).toUpperCase()} · ${timeframe} CANDLES`,
    dateLabel: `${formatMoment(candles[0]!.unixTime)} → ${formatMoment(candles.at(-1)!.unixTime)} UTC`,
    axis,
    circulatingSupply: chart.market?.circulatingSupply,
    bars: binned.bars,
    barEvents,
    bursts,
    events: tagEvents.filter((event) => layers.has(event.layer)),
    timeline,
    holdSeconds,
    effects: effectsOn,
    markers: markersOn,
  } : null), [axis, backgroundChoice, barEvents, binned.bars, bursts, candles, chart, chartStyle, customBackgroundColor, demo, effectsOn, holdSeconds, layers, lightLogo, logo, markersOn, range, shape, tagEvents, timeframe, timeline, tokenLogo, videoIcons, videoTheme]);

  const paint = useCallback((progress: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (!scene) {
      drawMessage(ctx, loadingCandles ? `Loading ${timeframe} candles…` : candleError || "Pick a window to replay");
      return;
    }
    drawChartFrame(ctx, progress * timeline.clipSeconds, scene);
  }, [candleError, loadingCandles, scene, timeframe, timeline.clipSeconds]);

  useEffect(() => {
    paint(playhead);
  }, [canvasNode, fontsReady, paint, playhead]);

  useEffect(() => {
    if (!playing || rendering || !scene) return;
    const started = performance.now() - playheadRef.current * clipSeconds * 1_000;
    let previous = playheadRef.current * clipSeconds;
    const tick = (now: number) => {
      const elapsed = (now - started) / (clipSeconds * 1_000);
      const next = looping ? elapsed % 1 : Math.min(elapsed, 1);
      const seconds = next * clipSeconds;
      audioRef.current?.play(cues, previous, seconds, sound);
      previous = seconds;
      playheadRef.current = next;
      setPlayhead(next);
      if (!looping && elapsed >= 1) {
        setPlaying(false);
        return;
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [clipSeconds, cues, looping, playing, rendering, scene, sound]);

  const exportKey = JSON.stringify({ renderer: 'outer-background-v3', candleKey, tagKey, density, shape, chartStyle, videoTheme, backgroundChoice, customBackgroundColor: backgroundChoice === 'custom' ? customBackgroundColor : undefined, clipSeconds, fps, axis, effectsOn, markersOn, holdSeconds, sound });
  const currentVideo = generated?.key === exportKey ? generated : null;

  const exportVideo = async () => {
    if (!encoder || encoder === "probing" || !scene || !chart) return;
    setPlaying(false);
    setRendering(true);
    setRenderProgress(0);
    setExportError("");
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const audio = encoder.audio && sound.enabled ? await renderSoundtrack(cues, clipSeconds, sound) : null;
      const blob = await encodeVideo({ shape, encoder, seconds: clipSeconds, fps, audio, draw: (ctx, seconds) => drawChartFrame(ctx, seconds, scene), onProgress: setRenderProgress, signal: controller.signal });
      const name = `birdeye-replayer-chart-${chart.token.symbol ?? "token"}-${chartStyle}-${videoTheme}-${backgroundChoice}-${timeframe}-${clipSeconds}s-${fps}fps-${VIDEO_FORMATS[shape].label.replace(":", "x")}.${encoder.ext}`;
      setGenerated({ url: URL.createObjectURL(blob), name, key: exportKey });
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setExportError(caught instanceof Error ? caught.message : "Video export failed");
    } finally {
      exportAbortRef.current = null;
      setRendering(false);
    }
  };

  const toggleLayer = (layer: TagLayer, on: boolean) => {
    setLayers((current) => {
      const next = new Set(current);
      if (on) next.add(layer);
      else next.delete(layer);
      return next;
    });
  };

  const busy = rendering;
  const usagePasses = [
    ...(chart?.usage ? [{ label: "Token", usage: chart.usage }] : []),
    ...(tagState?.usage && tagState.key === tagKey ? [{ label: "Tags", usage: tagState.usage }] : []),
  ];
  const countsByLayer = useMemo(() => {
    const counts = new Map<TagLayer, number>();
    for (const event of tagEvents) counts.set(event.layer, (counts.get(event.layer) ?? 0) + 1);
    return counts;
  }, [tagEvents]);

  const canExport = Boolean(scene && fontsReady && !loadingCandles && !loadingTags && encoder && encoder !== "probing");
  const markerCount = binned.bars.reduce((sum, entry) => sum + entry.events.length, 0);
  const connectionLabel = apiKey.trim() ? "Using your API key" : serverKey ? "Using app API key" : "Connect API key";
  // The mint on screen is already loaded: pressing again only re-spends credits.
  const alreadyLoaded = sameLookup(mintInput, chart ? { address: chart.token.mint, demo: chart.demo } : null);
  const retryData = () => {
    setCandleError("");
    setTagError("");
    setRetryNonce((value) => value + 1);
  };
  const sourceForm = <TokenForm mint={mintInput} onMintChange={setMintInput} onSubmit={submit}
    onSample={() => void loadToken("", { demo: true })} onConnection={() => setKeyOpen(true)}
    loading={loadingChart} alreadyLoaded={alreadyLoaded} needsKey={needsKey} error={error} variant={chart ? "editor" : "start"} />;

  function changeRange(next: TimeRange, final: boolean) {
    if (final) {
      setRange(next); setDraft(null); setTimeframeChoice(null); setPlaying(false);
      playheadRef.current = 0; setPlayhead(0); setCandleError(""); setTagError("");
    } else setDraft(next);
  }

  function togglePlayback() {
    audioRef.current?.unlock();
    if (!playing && playheadRef.current >= 0.999) { playheadRef.current = 0; setPlayhead(0); }
    setPlaying((value) => !value);
  }

  async function previewSound() {
    setPlaying(false);
    setPreviewingSound(true);
    setSoundError("");
    try {
      await audioRef.current?.audition(sound);
    } catch (error) {
      setSoundError(error instanceof Error ? error.message : "Sound preview failed.");
    } finally {
      setPreviewingSound(false);
    }
  }

  function showMobileSettings() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }

  return (
    <main className={`app-shell ${!chart ? "start-shell" : ""}`} onPointerDownCapture={() => audioRef.current?.unlock()}>
      <a href={chart ? "#preview" : "#start"} className="skip-link">{chart ? "Skip to preview" : "Skip to token form"}</a>
      <header className={`app-header ${!chart ? "start-header" : ""}`}>
        <ProductBrand />
        <FeatureSwitch active="chart" disabled={busy} />
        {chart && <div className="project-title"><span className="header-divider" /><span>{chart.token.symbol ?? "Token"} replay</span><span className="status-badge">{demo ? "Sample" : "Studio"}</span></div>}
        <div className="header-actions">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={connectionLabel} onClick={() => setKeyOpen(true)} disabled={busy}><Key size={18} /><span className={`connection-dot ${needsKey ? "pending" : ""}`} /></Button></TooltipTrigger><TooltipContent>{connectionLabel}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={() => {
            setTheme((value) => value === "light" ? "dark" : "light");
          }}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</Button></TooltipTrigger><TooltipContent>Switch appearance</TooltipContent></Tooltip>
          {chart && <Button className="export-button" variant="secondary" onClick={() => { setExportError(""); setExportOpen(true); }} disabled={!canExport || busy}><DownloadSimple size={17} weight="bold" /><span>{rendering ? `${Math.round(renderProgress * 100)}%` : "Export video"}</span></Button>}
        </div>
      </header>

      {!chart ? <>
        <section id="start" className="start-workspace" aria-labelledby="start-title" tabIndex={-1}>
          <div className="start-content"><h1 id="start-title">Start your replay.</h1><p>Pick a Solana token. Turn its chart into a story.</p>{sourceForm}</div>
        </section>
        <footer className="start-footer">Powered by <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Birdeye Data</a><span>·</span>Solana</footer>
      </> : <Tabs value={activePanel} onValueChange={(value) => { setActivePanel(value); showMobileSettings(); }} orientation={toolOrientation} className="studio-layout">
        <nav className="tool-rail" aria-label="Studio tools">
          <TabsList className="tool-list" onClick={showMobileSettings}>
            <TabsTrigger value="window" disabled={busy}><Scissors size={22} /><span>Period</span></TabsTrigger>
            <TabsTrigger value="tags" disabled={!chart || busy}><Tag size={22} /><span>Tags</span></TabsTrigger>
            <TabsTrigger value="format" disabled={!chart || busy}><FilmStrip size={22} /><span>Format</span></TabsTrigger>
            <TabsTrigger value="effects" disabled={!chart || busy}><Sparkle size={22} /><span>Effects</span></TabsTrigger>
          </TabsList>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="About data and API usage" className="rail-info" onClick={() => setUsageOpen(true)}><Info size={21} /></Button></TooltipTrigger><TooltipContent side="right">About & data usage</TooltipContent></Tooltip>
        </nav>

        <aside ref={settingsRef} className="settings-panel" aria-label="Replay settings">
          {chart && <a href="#preview" className="mobile-preview-link"><Play size={14} />Back to preview</a>}
          <TabsContent value="window" className="settings-content">
            <div className="panel-heading"><span className="eyebrow">01 / THE MOMENT</span><h1>Pick a replay period</h1><p>Choose the part of this token’s history to replay.</p></div>
            {!chart ? sourceForm : <>
              <section className="setting-section compact-source" aria-label="Selected token">
                <div className="source-token"><TokenAvatar key={chart.token.logo ?? mint} src={chart.token.logo} symbol={chart.token.symbol ?? "TOKEN"} size={34} /><div><strong title={chart.token.name ?? mint}>${chart.token.symbol ?? "TOKEN"}</strong><span>Solana · {short(mint)}</span></div></div>
                {demo && <p className="sample-notice">Sample data · simulated prices and trades</p>}
                <Button variant="outline" size="sm" className="change-token-button" onClick={() => { setError(""); setSourceOpen(true); }} disabled={busy}><ArrowsClockwise size={14} aria-hidden="true" />Change token</Button>
              </section>
              <section className="setting-section period-section">
                <div className="section-heading"><h2>Choose a period</h2></div>
                <div className="period-presets" role="group" aria-label="Replay period presets">
                  {RANGE_PRESETS.map((preset) => <Button key={preset} type="button" variant="outline" aria-pressed={activePreset === preset} disabled={busy || presetRepeatsFull(preset, chart.bounds)} title={presetRepeatsFull(preset, chart.bounds) ? `This token has ${formatSpan(chart.bounds.to - chart.bounds.from)} of history, so this is the same as Full history` : undefined} onClick={() => { setPickedPreset(preset); changeRange(presetRange(preset, chart.bounds, chart.history), true); }}>{PRESET_LABEL[preset]}{activePreset === preset && <Check size={14} aria-hidden="true" />}</Button>)}
                </div>
                {RANGE_PRESETS.some((preset) => presetRepeatsFull(preset, chart.bounds)) && <p className="field-hint">This token has {formatSpan(chart.bounds.to - chart.bounds.from)} of history, so longer presets would only repeat Full history.</p>}
                <div className="period-summary" role="status" aria-live="polite" aria-atomic="true">
                  <strong>{activePreset ? PRESET_LABEL[activePreset] : "Custom period"}<span>{formatSpan(shownRange!.to - shownRange!.from)} · UTC</span></strong>
                  <dl><div><dt>From</dt><dd>{formatMoment(shownRange!.from)}</dd></div><div><dt>To</dt><dd>{formatMoment(shownRange!.to)}</dd></div></dl>
                  <span>Plays in a <b>{clipSeconds}-second video.</b></span>
                </div>
                <details className="period-details">
                  <summary>Set exact dates<CaretDown size={15} aria-hidden="true" /></summary>
                  <div className="period-details-body">
                    <p className="field-hint">All times are in UTC. You can also drag the timeline handles to trim this period.</p>
                    {(["from", "to"] as const).map((edge) => <div className="field-stack" key={edge}><Label htmlFor={`window-${edge}`}>{edge === "from" ? "Start date & time" : "End date & time"}<span className="subtle">UTC</span></Label><Input id={`window-${edge}`} type="datetime-local" value={toInputValue(range![edge])} min={toInputValue(chart.bounds.from)} max={toInputValue(chart.bounds.to)} disabled={busy} onChange={(event) => { const value = fromInputValue(event.target.value); if (value !== null) changeRange(moveEdge(range!, edge, value, chart.bounds), true); }} /></div>)}
                  </div>
                </details>
              </section>
              <details className="period-details chart-detail">
                <summary><span>Chart detail<small>{timeframeChoice && timeframeChoice === timeframe ? "Custom" : "Automatic"} · {INTERVAL_LABEL[timeframe]}</small></span><CaretDown size={15} aria-hidden="true" /></summary>
                <div className="period-details-body">
                  <div className="field-stack"><Label htmlFor="chart-detail">Time per data point</Label><div className="select-wrap"><select id="chart-detail" className="select-field" value={timeframeChoice === timeframe ? timeframeChoice : "auto"} disabled={busy} onChange={(event) => { setTimeframeChoice(event.target.value === "auto" ? null : event.target.value as ReplayTimeframe); setPlaying(false); setCandleError(""); }}><option value="auto">Automatic (recommended)</option>{REPLAY_TIMEFRAMES.filter((option) => timeframeAllowed(range!, option)).map((option) => <option key={option} value={option}>{INTERVAL_LABEL[option]}</option>)}</select><CaretDown size={16} aria-hidden="true" /></div></div>
                  <p className="field-hint">Each {chartStyle === "candles" ? "candle" : "point"} covers {INTERVAL_LABEL[timeframe]}. A shorter interval shows more detail; it doesn’t change the video length.</p>
                  <p className="field-hint">{candles ? `${candles.length.toLocaleString()} data points` : "Loading chart…"} · Available intervals fit the selected period.</p>
                </div>
              </details>
              {candleError && <p className="inline-alert danger" role="alert">{candleError}<button type="button" className="alert-action" onClick={retryData}>Try again</button></p>}
            </>}
          </TabsContent>

          <TabsContent value="tags" className="settings-content">
            <div className="panel-heading"><span className="eyebrow">02 / THE MONEY</span><h1>Follow the trades</h1><p>Show who moved, and when they did.</p></div>
            <section className="setting-section">
              <div className="section-heading"><h2>Wallet layers</h2><span className="subtle">{layers.size} active</span></div>
              <div className="layer-list">{TAG_LAYERS.map((layer) => <div key={layer} className={`layer-row ${layers.has(layer) ? "on" : ""}`}>
                <span className="layer-icon"><LayerIcon layer={layer} /></span><div className="layer-copy"><Label htmlFor={`layer-${layer}`}>{LAYER_INFO[layer].label}{layers.has(layer) && countsByLayer.has(layer) && <span className="layer-count">{countsByLayer.get(layer)}</span>}</Label><p>{LAYER_DESCRIPTIONS[layer]}</p></div><Switch id={`layer-${layer}`} aria-label={LAYER_INFO[layer].label} checked={layers.has(layer)} onCheckedChange={(on) => { toggleLayer(layer, on); setTagError(""); }} disabled={busy} />
              </div>)}</div>
            </section>
            <section className="setting-section"><div className="section-heading"><h2>Big trade threshold</h2></div>
              <div className="select-wrap"><select className="select-field" aria-label="Big trade size" value={String(bigSize)} onChange={(event) => { setBigSize(event.target.value === "auto" ? "auto" : Number(event.target.value) as BigSize); setTagError(""); }} disabled={busy || !layers.has("big")}>
                {BIG_SIZES.map((size) => <option key={size} value={size}>{size === "auto" ? "Auto · recommended" : `${compactUsd(size)} and above`}</option>)}
              </select><CaretDown size={16} aria-hidden="true" /></div><p className="field-hint">{tagState?.bigThresholdUsd && layers.has("big") ? `Currently showing swaps of ${compactUsd(tagState.bigThresholdUsd)} or more.` : "Auto finds a threshold that keeps the important trades readable."}</p>
            </section>
            <section className="setting-section"><div className="section-heading"><h2>Marker density</h2></div><Segmented label="Marker density" options={["key", "normal", "all"] as const} value={density} onChange={setDensity} disabled={busy} render={(value) => value === "key" ? "Key moments" : value === "normal" ? "Balanced" : "Detailed"} /><p className="field-hint">Track up to {DENSITY_LIMIT[density]} moments per layer. Pins stay on the chart after they appear.</p><SwitchField id="names" label="Show wallet names" checked={names} onChange={setNames} disabled={busy} /></section>
            <div className="panel-tip"><Info size={18} /><p>Wallet layers show a group’s net buy or sell flow. Big trades show individual swaps.</p></div>
          </TabsContent>

          <TabsContent value="format" className="settings-content">
            <div className="panel-heading"><span className="eyebrow">03 / THE FORMAT</span><h1>Made to share</h1><p>The right fit for your next post.</p></div>
            <section className="setting-section"><div className="section-heading"><h2>Chart style</h2></div>
              <Segmented label="Chart style" options={["line", "candles"] as const} value={chartStyle} onChange={setChartStyle} disabled={busy} render={(value) => value === "line" ? "Line" : "Candles"} />
              <p className="field-hint">{chartStyle === "line" ? "A clear view of price movement." : "Open, high, low and close for each interval."}</p>
            </section>
            <section className="setting-section"><div className="section-heading"><h2>Video theme</h2></div>
              <Segmented label="Video theme" options={["light", "dark"] as const} value={videoTheme} onChange={setVideoTheme} disabled={busy} render={(value) => value === "light" ? "Light" : "Dark"} />
              <p className="field-hint">Light or dark chart card. Applies to preview and export.</p>
            </section>
            <section className="setting-section video-background-section"><div className="section-heading"><h2>Frame background</h2><span className="subtle">{videoBackground(backgroundChoice, videoTheme, customBackgroundColor).label}</span></div>
              <p className="field-hint">Choose the color around the chart card.</p>
              {(["solid", "gradient"] as const).map((kind) => <fieldset className="background-palette" key={kind} disabled={busy}><legend>{kind === "solid" ? "Solid colors" : "Gradients"}</legend><div className="background-swatches">
                {VIDEO_BACKGROUNDS.filter((item) => item.kind === kind).map((item) => {
                  const background = videoBackground(item.id, videoTheme);
                  return <button type="button" key={item.id} className="background-swatch" aria-label={`${item.label} ${kind} background`} aria-pressed={backgroundChoice === item.id} onClick={() => setBackgroundChoice(item.id)}>
                    <span className="background-swatch-color" style={{ background: background.swatch, color: background.ink }} aria-hidden="true">{backgroundChoice === item.id && <Check size={17} weight="bold" />}</span><span>{item.label}</span>
                  </button>;
                })}
              </div>{kind === 'solid' && <div className={`custom-background ${backgroundChoice === 'custom' ? 'selected' : ''}`}>
                <input type="color" id="custom-frame-color" aria-label="Choose custom frame color" value={customBackgroundColor} onChange={(event) => { setCustomBackgroundColor(event.target.value); setBackgroundChoice('custom'); }} />
                <label htmlFor="custom-frame-color">Custom color<code>{customBackgroundColor.toUpperCase()}</code></label>
                <button type="button" className="custom-background-use" aria-label="Use custom solid background" aria-pressed={backgroundChoice === 'custom'} onClick={() => setBackgroundChoice('custom')}>{backgroundChoice === 'custom' ? <Check size={16} aria-hidden="true" /> : 'Use'}</button>
              </div>}</fieldset>)}
              <p className="field-hint">Brand follows the video theme. Other colors stay as selected.</p>
            </section>
            <section className="setting-section"><div className="section-heading"><h2>Aspect ratio</h2></div>
              <Segmented label="Aspect ratio" options={Object.keys(VIDEO_FORMATS) as VideoShape[]} value={shape} onChange={setShape} disabled={busy} render={(value) => VIDEO_FORMATS[value].label} />
              <p className="field-hint">{shape === "feed" ? "Feed · Instagram & social posts" : shape === "portrait" ? "Portrait · Stories, Reels & TikTok" : shape === "landscape" ? "Landscape · YouTube & presentations" : "Square · Social feeds"}</p>
            </section>
            <section className="setting-section"><div className="section-heading"><h2>Clip length</h2><span className="small-badge">{clock(clipSeconds)}</span></div><Segmented label="Video length" options={CLIP_DURATIONS.map(String)} value={CLIP_DURATIONS.some((seconds) => seconds === clipSeconds) ? String(clipSeconds) : null} onChange={(value) => setClipSeconds(Number(value))} disabled={busy} render={(value) => `${value}s`} /><Slider aria-label="Adjust video length" min={MIN_VIDEO_SECONDS} max={Math.min(120, MAX_VIDEO_SECONDS)} step={1} value={[clipSeconds]} disabled={busy} onValueChange={([value]) => setClipSeconds(value ?? clipSeconds)} /><p className="field-hint">Includes a {timeline.outroSeconds.toFixed(1)}s final hold at the end.</p></section>
            <section className="setting-section"><div className="section-heading"><h2>Frame rate</h2></div><Segmented label="Frame rate" options={FRAME_RATES.map(String)} value={String(fps)} onChange={(value) => setFpsChoice(Number(value) as FrameRate)} disabled={busy} isDisabled={(value) => Boolean(encoder && encoder !== "probing" && Number(value) > encoder.maxFps)} render={(value) => `${value} fps`} /><p className="field-hint">{fps === 60 ? "Smoother motion, longer render time." : "Faster rendering and a smaller file."}</p></section>
            <section className="setting-section"><div className="section-heading"><h2>Chart values</h2></div><Segmented label="Chart axis" options={["price", "mcap"] as const} value={axis} onChange={setAxisChoice} disabled={busy} isDisabled={(value) => value === "mcap" && !supplyKnown} render={(value) => value === "price" ? "Price" : "Market cap"} /><p className="field-hint">{supplyKnown ? "Market cap uses today’s circulating supply." : "Market cap is available when supply data is known."}</p></section>
          </TabsContent>

          <TabsContent value="effects" className="settings-content">
            <div className="panel-heading"><span className="eyebrow">04 / THE FEEL</span><h1>A little more life</h1><p>Let the important moments stand out.</p></div>
            <section className="setting-section"><div className="section-heading"><h2>Visuals</h2></div><SwitchField id="fx-markers" label="Trade markers" checked={markersOn} onChange={setMarkersOn} disabled={busy} /><SwitchField id="fx-popups" label="Moment callouts" checked={effectsOn} onChange={setEffectsOn} disabled={busy} /><div className="field-stack"><Label>Callout duration<span>{holdSeconds.toFixed(1)}s</span></Label><Slider aria-label="Popup hold" min={0.4} max={2.5} step={0.1} value={[holdSeconds]} disabled={busy || !effectsOn} onValueChange={([value]) => setHoldSeconds(value ?? holdSeconds)} /></div></section>
            <section className="setting-section"><div className="section-heading"><h2>Sound</h2></div><SwitchField id="sound-enabled" label="Include sound" checked={sound.enabled} onChange={(enabled) => { audioRef.current?.unlock(); setSound((value) => ({ ...value, enabled })); }} disabled={busy || previewingSound} /><Segmented label="Sound pack" options={["glass", "clean", "meme"] as const} value={sound.pack} onChange={(pack) => setSound((value) => ({ ...value, pack, milestones: pack === "glass" ? false : value.milestones }))} disabled={busy || !sound.enabled || previewingSound} render={(value) => SOUND_PACK_LABELS[value]} /><p className="field-hint">{sound.pack === "glass" ? "Soft sweeps for key trades, a glass chime to finish. No price ticks or voice lines." : sound.pack === "meme" ? "Playful trade sounds, price milestones and a result sting." : "Subtle trade blips, milestone tones and a result sting."}</p>
              <SwitchField id="sound-trades" label="Trade sounds" checked={sound.trades} onChange={(trades) => setSound((value) => ({ ...value, trades }))} disabled={busy || !sound.enabled} />
              {sound.pack !== "glass" && <SwitchField id="sound-milestones" label="Price milestones" checked={sound.milestones} onChange={(milestones) => setSound((value) => ({ ...value, milestones }))} disabled={busy || !sound.enabled} />}
              <SwitchField id="sound-outro" label={sound.pack === "glass" ? "End chime" : "Result sting"} checked={sound.outro} onChange={(outro) => setSound((value) => ({ ...value, outro }))} disabled={busy || !sound.enabled} />
              <Button variant="outline" onClick={() => void previewSound()} disabled={busy || previewingSound || !sound.enabled || (!sound.trades && !sound.outro && !sound.milestones)}>{previewingSound ? <CircleNotch size={16} className="spin" /> : <SpeakerHigh size={16} />}{previewingSound ? "Playing sound…" : "Preview sound"}</Button>
              {soundError && <p className="inline-alert danger" role="alert">{soundError}</p>}
            </section>
          </TabsContent>
          <div className="panel-footer"><span>Powered by <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Birdeye Data</a></span><span className="small-badge">Solana</span></div>
        </aside>

        <section id="preview" className={`preview-workspace ${chart ? "has-chart" : "is-empty"}`} aria-label="Video workspace" tabIndex={-1}>
          <div className="workspace-heading"><div><span className="eyebrow">YOUR REPLAY</span><h2>{chart ? `${chart.token.symbol ?? "Token"}, in motion.` : "A chart. A moment. A story."}</h2></div>{chart && <div className="preview-meta"><span className="status-badge">{demo ? "Sample data" : "Live data"}</span><span>{VIDEO_FORMATS[shape].label} <span className="meta-divider">/</span> {clipSeconds}s</span></div>}</div>
          {chart ? <>
            <div className={`video-stage ${shape}`} aria-busy={loadingCandles || loadingTags}>
              <canvas ref={attachCanvas} width={VIDEO_FORMATS[shape].width} height={VIDEO_FORMATS[shape].height} aria-label="Video preview: token chart with trade markers" />
              {(loadingCandles || loadingTags || loadingChart) && <div className="stage-status" role="status"><CircleNotch size={15} className="spin" />{loadingChart ? "Loading token…" : loadingCandles ? "Loading candles…" : "Finding the trades…"}</div>}
              {!loadingCandles && !loadingTags && sound.enabled && playing && !audioRunning && <button type="button" className="stage-status sound-blocked" onClick={() => audioRef.current?.unlock()}><SpeakerSlash size={14} />Click to enable sound</button>}
            </div>
            <div className="stage-caption"><div className="stage-layers">{layerList.map((layer) => <span key={layer}><LayerIcon layer={layer} size={13} />{LAYER_INFO[layer].label}</span>)}{layerList.length === 0 && <span>Chart only</span>}</div><span>{markerCount} tracked moments<span className="caption-desktop"> · {candles?.length ?? 0} points</span></span></div>
          </> : <div className="empty-stage"><div className="empty-icon"><ChartLineUp size={35} weight="light" /></div><span className="eyebrow">FROM CHART TO CLIP</span><h2>Every chart has a story.<br />Make yours move.</h2><p>Pick a Solana token, find a moment,<br className="desktop-break" /> and turn it into a replay worth sharing.</p><Button variant="secondary" onClick={() => void loadToken("", { demo: true })} disabled={loadingChart}>{loadingChart ? <CircleNotch className="spin" /> : <Play size={16} weight="fill" />}{loadingChart ? "Loading sample…" : "Explore a sample replay"}</Button><span className="empty-footnote">No API key needed. Just a little curiosity.</span><div className="empty-features"><span><Scissors size={16} />Pick the moment</span><span><Tag size={16} />Follow the money</span><span><FilmStrip size={16} />Share the story</span></div></div>}
          {chart && (tagError || candleError) && <p className="workspace-alert inline-alert danger" role="alert">{candleError || tagError}<button type="button" className="alert-action" onClick={retryData}>Try again</button></p>}
          {chart && !fontsReady && exportError && <p className="workspace-alert inline-alert danger" role="alert">{exportError}</p>}
          {chart && encoder === null && <p className="workspace-alert inline-alert danger" role="alert">Video export is unavailable in this browser. Use a browser with WebCodecs support.</p>}
          <section className="timeline-dock" aria-label="Replay timeline">
            <div className="playback-bar"><div className="playback-options"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={sound.enabled ? "Mute preview and export" : "Enable sound"} onClick={() => { audioRef.current?.unlock(); setSound((value) => ({ ...value, enabled: !value.enabled })); }} disabled={!chart || busy}>{sound.enabled ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />}</Button></TooltipTrigger><TooltipContent>Sound</TooltipContent></Tooltip><Button variant="ghost" size="icon" aria-label="Loop preview" aria-pressed={looping} className={looping ? "is-on" : ""} onClick={() => setLooping((value) => !value)} disabled={!chart || busy}><ArrowsClockwise size={18} /></Button></div>
              <div className="playback-center"><Button variant="ghost" size="icon" aria-label="Restart preview" onClick={() => { setPlaying(false); playheadRef.current = 0; setPlayhead(0); }} disabled={!scene || busy}><SkipBack size={16} weight="fill" /></Button><Button size="icon" className="play-button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={togglePlayback} disabled={!scene || busy}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</Button><span className="playback-time">{clock(playhead * clipSeconds)}<span> / {clock(clipSeconds)}</span></span></div>
              <div className="playback-quality"><span>1080p</span><span>{fps} fps</span></div>
            </div>
            <div className="playhead-row"><Slider aria-label="Video playhead" min={0} max={1000} step={1} value={[Math.round(playhead * 1000)]} disabled={!scene || busy} onValueChange={([value]) => { const next = (value ?? 0) / 1000; setPlaying(false); playheadRef.current = next; setPlayhead(next); }} /></div>
            {chart && range ? <div className="history-timeline"><div className="timeline-heading"><strong><ChartLineUp size={15} />Trim replay period</strong><span>{formatMoment((shownRange ?? range).from, false)} — {formatMoment((shownRange ?? range).to, false)} <span className="subtle">UTC</span></span></div><RangePicker history={chart.history} bounds={chart.bounds} value={shownRange ?? range} disabled={busy} onChange={changeRange} compact /><div className="timeline-footnote"><span>Drag the handles to adjust the selected period</span><span>{formatSpan((shownRange ?? range).to - (shownRange ?? range).from)} selected</span></div></div> : <div className="timeline-empty"><SlidersHorizontal size={17} /><span>Your history timeline will appear here.</span><span className="subtle">Load a token to begin</span></div>}
          </section>
        </section>
      </Tabs>}

      <Dialog open={sourceOpen} onOpenChange={(open) => !busy && setSourceOpen(open)}><DialogContent className="studio-dialog"><DialogHeader><DialogTitle>Start with a token</DialogTitle><DialogDescription>Load a new token to choose a different story.</DialogDescription></DialogHeader>{sourceForm}</DialogContent></Dialog>
      <Dialog open={keyOpen} onOpenChange={(open) => !busy && setKeyOpen(open)}><DialogContent className="studio-dialog"><DialogHeader><DialogTitle>Connect to Birdeye</DialogTitle><DialogDescription>Your key gives this studio access to real Solana token data.</DialogDescription></DialogHeader><div className="field-stack"><Label htmlFor="api-key">Birdeye Data API key{serverKey && <span className="subtle">Optional</span>}</Label><Input id="api-key" ref={keyInputRef} type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setVisitorApiKey(event.target.value); }} placeholder={serverKey ? "Use your own key, or keep the app key" : "Paste your API key"} autoComplete="off" spellCheck={false} /><p className="field-hint">Kept in this tab’s memory only. Sent through this app’s server to Birdeye; never saved to your device.</p></div><a className="text-link" href="https://data.birdeye.so" target="_blank" rel="noreferrer">Get a Birdeye API key <ArrowRight size={14} /></a><Button onClick={() => { setKeyOpen(false); if (!apiKey.trim() && !serverKey) void loadToken("", { demo: true }); }}>{apiKey.trim() || serverKey ? <><Check size={17} />Done</> : "Continue with sample data"}</Button></DialogContent></Dialog>
      <Dialog open={exportOpen} onOpenChange={(open) => !rendering && setExportOpen(open)}><DialogContent className="studio-dialog export-dialog" showCloseButton={!rendering}><DialogHeader><DialogTitle>{currentVideo ? "Ready for the world." : "Export your replay"}</DialogTitle><DialogDescription>{currentVideo ? "Your video is ready. Save it and share the story." : "A crisp clip, rendered right here in your browser."}</DialogDescription></DialogHeader>
        <div className="export-summary"><div><span>Format</span><strong>{encoder && encoder !== "probing" ? encoder.ext.toUpperCase() : "Checking…"} · {VIDEO_FORMATS[shape].label}</strong></div><div><span>Resolution</span><strong>{VIDEO_FORMATS[shape].width} × {VIDEO_FORMATS[shape].height}</strong></div><div><span>Duration</span><strong>{clipSeconds} seconds · {fps} fps</strong></div><div><span>Audio</span><strong>{sound.enabled ? encoder && encoder !== "probing" && encoder.audio ? `${SOUND_PACK_LABELS[sound.pack]} sound pack` : "Unavailable in this browser" : "Silent"}</strong></div></div>
        {rendering && <div className="render-status" role="status"><div><CircleNotch className="spin" size={18} /><strong>Rendering your story…</strong><span>{Math.round(renderProgress * 100)}%</span></div><progress max={1} value={renderProgress} aria-label="Video rendering progress" /><p className="field-hint">Keep this tab open while we finish.</p><Button variant="outline" onClick={() => exportAbortRef.current?.abort()}>Cancel render</Button></div>}
        {currentVideo && !rendering && <div className="generated-video"><video src={currentVideo.url} controls playsInline aria-label="Exported replay" /><Button variant="secondary" asChild><a href={currentVideo.url} download={currentVideo.name}><DownloadSimple size={17} />Save video</a></Button></div>}
        {!rendering && !currentVideo && <Button variant="secondary" onClick={() => void exportVideo()} disabled={!canExport}><DownloadSimple size={17} />Render {encoder && encoder !== "probing" ? encoder.ext.toUpperCase() : "video"}</Button>}
        {exportError && <p className="inline-alert danger" role="alert">{exportError}</p>}
      </DialogContent></Dialog>
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}><DialogContent className="studio-dialog usage-dialog"><DialogHeader><DialogTitle>The data behind the story</DialogTitle><DialogDescription>Token prices, candles and wallet tags are provided by Birdeye Data API.</DialogDescription></DialogHeader>{demo && <p className="inline-alert"><Info size={16} />This replay uses synthetic sample data.</p>}{usagePasses.length > 0 ? <UsagePanel passes={usagePasses} keySource={chart?.keySource} /> : <p className="field-hint">Load a token to see request and compute-unit usage here.</p>}{tagState?.key === tagKey && tagState.notes.map((note) => <p key={note} className="field-hint">{note}</p>)}<p className="field-hint">Market cap is estimated from today’s circulating supply. Wallet tags may be unavailable for some tokens.</p><a className="text-link" href="https://data.birdeye.so" target="_blank" rel="noreferrer">About Birdeye Data <ArrowRight size={14} /></a></DialogContent></Dialog>
    </main>
  );
}
