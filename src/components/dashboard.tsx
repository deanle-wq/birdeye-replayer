"use client";

import { FeatureSwitch, ProductBrand } from "@/components/product-brand";
import { useTheme } from "@/lib/use-theme";
import { ArrowRight, Check, CheckCircle, CircleNotch, Coins, Info, Key, Moon, Plus, ShieldCheck, Sun, VideoCamera, Wallet, WarningCircle } from "@phosphor-icons/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch, setVisitorApiKey, visitorApiKey } from "@/lib/api-client";
import { sameLookup, TimedCache, type LoadedLookup } from "@/lib/lookup-state";
import {
  boardRowForToken,
  DEMO_WALLET,
  identityTags,
  mergeTokens,
  type WalletPortfolio,
  type WalletTokenRow,
} from "@/lib/wallet-portfolio";
import type { ApiUsage } from "@/server/birdeye/usage";
import type { BoardRow, TokenAnalysis } from "@/server/services/analyze-token";
import { money, MultiplePill, short, TokenAvatar, UsagePanel, WalletAvatar } from "./shared";
import { WalletVideoModal } from "./wallet-video-modal";
import { WalletView } from "./wallet-view";

const SAMPLE_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Mode = "token" | "wallet";

/** Where a lookup lives in the address bar, so links can be shared and Back works. */
function readLocation(): { mode: Mode; value: string } | null {
  const params = new URLSearchParams(window.location.search);
  const wallet = params.get("wallet")?.trim();
  if (wallet && SOLANA_ADDRESS.test(wallet)) return { mode: "wallet", value: wallet };
  const mint = params.get("mint")?.trim();
  if (mint && SOLANA_ADDRESS.test(mint)) return { mode: "token", value: mint };
  return null;
}

function writeLocation(mode: Mode, value: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set(mode === "token" ? "mint" : "wallet", value);
  if (url.toString() !== window.location.href) window.history.pushState({ mode, value }, "", url);
}

function PriceChart({ values }: { values: TokenAnalysis["candles"] }) {
  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: "", area: "" };
    const width = 960;
    const height = 220;
    const prices = values.map((item) => item.c);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = max - min || 1;
    const points = values.map((item, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((item.c - min) / spread) * (height - 24) - 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: points.join(" "), area: `0,${height} ${points.join(" ")} ${width},${height}` };
  }, [values]);

  return (
    <figure className="chart" aria-label="Token price history">
      {line ? (
        <svg viewBox="0 0 960 220" preserveAspectRatio="none" role="img" aria-label="Price chart">
          <defs>
            <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#61D38A" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#61D38A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#chart-fill)" />
          <polyline points={line} fill="none" stroke="#61D38A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p>No candles returned for this range.</p>
      )}
      <figcaption>Price · {values[0]?.type ?? "OHLCV"} candles · Birdeye OHLCV V3</figcaption>
    </figure>
  );
}

function Confidence({ level, holderOnly }: { level?: "high" | "medium" | "low"; holderOnly?: boolean }) {
  if (!level && holderOnly) {
    return <Badge variant="outline" className="pill neutral" title="No swaps on this token: ranked by holdings only">Holder only</Badge>;
  }
  if (!level) return <Badge variant="outline" className="pill neutral">Birdeye WAC</Badge>;
  const Icon = level === "high" ? CheckCircle : level === "medium" ? ShieldCheck : WarningCircle;
  return (
    <Badge variant="outline" className={`pill ${level}`}>
      <Icon size={13} weight="fill" aria-hidden="true" /> {level[0]!.toUpperCase() + level.slice(1)} confidence
    </Badge>
  );
}

export function Dashboard() {
  const [theme, setTheme] = useTheme();
  const [keyOpen, setKeyOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("token");
  // Which result is on screen; the mode switch only changes the input.
  const [view, setView] = useState<Mode | null>(null);
  const [mint, setMint] = useState("");
  const [walletInput, setWalletInput] = useState("");
  const [data, setData] = useState<TokenAnalysis | null>(null);
  const [walletData, setWalletData] = useState<WalletPortfolio | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [videoWallet, setVideoWallet] = useState<string | null>(null);
  const [walletVideo, setWalletVideo] = useState<{ data: TokenAnalysis; row: BoardRow } | null>(null);
  const [openingMint, setOpeningMint] = useState<string | null>(null);
  const [usage, setUsage] = useState<Array<{ label: string; usage: ApiUsage }>>([]);
  const [walletUsage, setWalletUsage] = useState<Array<{ label: string; usage: ApiUsage }>>([]);
  // Ledgers built from the Video modal. Kept apart from `data` so the
  // background audit response cannot overwrite a row the user already audited.
  const [ledgerRows, setLedgerRows] = useState<Record<string, BoardRow>>({});
  // The visitor's own Birdeye key: React state and api-client memory only,
  // so a key typed in the other feature is already connected here.
  const [apiKey, setApiKey] = useState(visitorApiKey);
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier lookup landing after a newer one.
  const requestRef = useRef(0);
  // The token whose leading-wallet audit finished; a board without it is not settled.
  const [auditedMint, setAuditedMint] = useState<string | null>(null);
  const loadedToken: LoadedLookup | null = data ? { address: data.token.mint, demo: data.demo, settled: auditedMint === data.token.mint } : null;
  const loadedWallet: LoadedLookup | null = walletData ? { address: walletData.wallet, demo: walletData.demo } : null;
  // Read inside the load callbacks without making them change every render.
  const loadedRef = useRef({ token: loadedToken, wallet: loadedWallet });
  useEffect(() => {
    loadedRef.current = { token: loadedToken, wallet: loadedWallet };
  });
  // Token context and audited rows for wallet-view videos: reopening one reuses them.
  const tokenContextCache = useRef(new TimedCache<TokenAnalysis>(5 * 60_000));
  const [walletLedgerRows, setWalletLedgerRows] = useState<Record<string, BoardRow>>({});


  const needsKey = serverKey === false && apiKey.trim() === "";

  const requireKey = useCallback((): boolean => {
    if (!needsKey) return true;
    setError("Add your Birdeye Data API key first. It stays in this tab's memory only.");
    setKeyOpen(true);
    return false;
  }, [needsKey]);

  const scrollToResults = () => {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const loadToken = useCallback(async (target: string, options: { push?: boolean; demo?: boolean } = {}) => {
    const value = target.trim();
    setError("");
    setMode("token");
    // The sample stays out of the input; a real lookup shows its mint.
    setMint(options.demo ? "" : value);
    // Already on screen (a link from the wallet view, Back/Forward): switch, don't refetch.
    if (!options.demo && sameLookup(value, loadedRef.current.token)) {
      setView("token");
      if (options.push !== false) writeLocation("token", value);
      return;
    }
    if (!options.demo && !SOLANA_ADDRESS.test(value)) {
      setError("Paste a Solana token mint: base58, 32–44 characters.");
      return;
    }
    if (!options.demo && !requireKey()) return;
    const request = ++requestRef.current;
    setLoading(true);
    setAuditing(false);
    setLedgerRows({});
    setUsage([]);
    setVideoWallet(null);
    try {
      const encodedMint = encodeURIComponent(value);
      const response = await apiFetch(options.demo ? `/api/analyze?demo=1&mint=${encodedMint}` : `/api/analyze?mint=${encodedMint}&audit=0`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) setKeyOpen(true);
        throw new Error(body.error ?? "Analysis failed");
      }
      if (request !== requestRef.current) return;
      setData(body);
      setView("token");
      if (!options.demo && options.push !== false) writeLocation("token", value);
      if (body.usage) setUsage([{ label: "Board", usage: body.usage }]);
      setLoading(false);
      scrollToResults();
      if (options.demo) return;

      setAuditing(true);
      const auditResponse = await apiFetch(`/api/analyze?mint=${encodedMint}&audit=1`);
      const auditedBody = await auditResponse.json();
      if (!auditResponse.ok) throw new Error(auditedBody.error ?? "Deep audit failed");
      if (request !== requestRef.current) return;
      setData(auditedBody);
      setAuditedMint(value);
      if (auditedBody.usage) setUsage((passes) => [...passes, { label: "Leading-wallet audit", usage: auditedBody.usage }]);
    } catch (caught) {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setAuditing(false);
      }
    }
  }, [requireKey]);

  const loadWallet = useCallback(async (target: string, options: { push?: boolean; demo?: boolean } = {}) => {
    const value = target.trim();
    setError("");
    setMode("wallet");
    setWalletInput(options.demo ? "" : value);
    if (!options.demo && sameLookup(value, loadedRef.current.wallet)) {
      setView("wallet");
      if (options.push !== false) writeLocation("wallet", value);
      return;
    }
    if (!options.demo && !SOLANA_ADDRESS.test(value)) {
      setError("Paste a Solana wallet address: base58, 32–44 characters.");
      return;
    }
    if (!options.demo && !requireKey()) return;
    const request = ++requestRef.current;
    setLoading(true);
    setAuditing(false);
    setWalletUsage([]);
    setWalletVideo(null);
    try {
      const response = await apiFetch(options.demo ? "/api/wallet?demo=1" : `/api/wallet?wallet=${encodeURIComponent(value)}`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) setKeyOpen(true);
        throw new Error(body.error ?? "Wallet lookup failed");
      }
      if (request !== requestRef.current) return;
      setWalletData(body);
      setWalletInput(options.demo ? "" : body.wallet);
      setView("wallet");
      if (!options.demo && options.push !== false) writeLocation("wallet", value);
      if (body.usage) setWalletUsage([{ label: "Wallet", usage: body.usage }]);
      scrollToResults();
    } catch (caught) {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Wallet lookup failed");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [requireKey]);

  // Learn whether the deployment has a key, then open what the address bar
  // asks for. Back and Forward between lookups are handled below.
  const bootedRef = useRef(false);
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
        if (target.mode === "wallet") setWalletInput(target.value);
        else setMint(target.value);
        setMode(target.mode);
        if (!configured) {
          setError("Add your Birdeye Data API key, then press the button to open this link.");
          return;
        }
        void (target.mode === "wallet" ? loadWallet(target.value, { push: false }) : loadToken(target.value, { push: false }));
      })
      .catch(() => setServerKey(false));
  }, [loadToken, loadWallet]);

  useEffect(() => {
    const onPop = () => {
      const target = readLocation();
      if (!target) {
        setView(null);
        return;
      }
      void (target.mode === "wallet" ? loadWallet(target.value, { push: false }) : loadToken(target.value, { push: false }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadToken, loadWallet]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void (mode === "token" ? loadToken(mint) : loadWallet(walletInput));
  }

  function loadDemo() {
    void (mode === "token" ? loadToken(SAMPLE_MINT, { demo: true }) : loadWallet(DEMO_WALLET, { demo: true }));
  }

  async function loadMoreTokens() {
    if (!walletData || walletData.nextOffset === null || walletData.demo) return;
    setLoadingMore(true);
    try {
      const window = walletData.historyWindow === "90d" ? "&window=90d" : "";
      const response = await apiFetch(`/api/wallet?wallet=${encodeURIComponent(walletData.wallet)}&offset=${walletData.nextOffset}${window}`);
      const body = (await response.json()) as WalletPortfolio & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load more tokens");
      setWalletData((current) => current && current.wallet === body.wallet
        ? { ...current, tokens: mergeTokens(current.tokens, body.tokens), hiddenQuoteAssets: current.hiddenQuoteAssets + body.hiddenQuoteAssets, nextOffset: body.nextOffset }
        : current);
      if (body.usage) setWalletUsage((passes) => [...passes, { label: `Tokens from ${walletData.nextOffset}`, usage: body.usage! }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more tokens");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openWalletVideo(token: WalletTokenRow) {
    if (!walletData) return;
    if (!walletData.demo && !requireKey()) return;
    setError("");
    setOpeningMint(token.mint);
    try {
      const encodedMint = encodeURIComponent(token.mint);
      const cacheKey = `${walletData.demo ? "demo:" : ""}${token.mint}`;
      const cached = tokenContextCache.current.get(cacheKey);
      let context: TokenAnalysis;
      if (cached) {
        context = cached;
      } else {
        const response = await apiFetch(walletData.demo ? `/api/token?demo=1&mint=${encodedMint}` : `/api/token?mint=${encodedMint}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load this token's chart");
        context = body as TokenAnalysis;
        tokenContextCache.current.set(cacheKey, context);
        if (context.usage) setWalletUsage((passes) => [...passes, { label: `$${token.symbol} chart`, usage: context.usage! }]);
      }
      const tags = identityTags(walletData.identity);
      // The sample board carries an audited row for the sample wallet; a
      // ledger built on an earlier open of this video is reused as is.
      const sample = context.board.find((entry) => entry.wallet === walletData.wallet);
      const row = walletLedgerRows[`${token.mint}:${walletData.wallet}`] ?? sample ?? boardRowForToken(walletData.wallet, token, tags);
      setWalletVideo({ data: context, row: { ...row, tags: row.tags.length > 0 ? row.tags : tags } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this token's chart");
    } finally {
      setOpeningMint(null);
    }
  }

  const board = useMemo(() => {
    if (!data) return [];
    const merged = data.board.map((row) => (row.audit ? row : ledgerRows[row.wallet] ?? row));
    return Object.keys(ledgerRows).length > 0 ? merged.sort((a, b) => b.totalUsd - a.totalUsd) : merged;
  }, [data, ledgerRows]);
  const confidence = useMemo(() => ({
    high: board.filter((row) => row.audit?.confidence === "high").length,
    medium: board.filter((row) => row.audit?.confidence === "medium").length,
    low: board.filter((row) => row.audit?.confidence === "low").length,
  }), [board]);
  const leaders = board.slice(0, 30);
  const videoRow = board.find((row) => row.wallet === videoWallet);
  const busy = loading || auditing;
  // In the sample, only the sample wallet has a wallet page.
  const canOpenWallet = (wallet: string) => !data?.demo || wallet === DEMO_WALLET;

  const hasWorkspace = view !== null;
  const connectionLabel = apiKey.trim() ? "Using your API key" : serverKey ? "Using app API key" : "Connect API key";
  const activeUsage = view === "wallet" ? walletUsage : usage;

  function selectMode(next: Mode) {
    setMode(next);
    setError("");
    if (hasWorkspace && next === "token" && data) { setView("token"); if (!data.demo) writeLocation("token", data.token.mint); }
    if (hasWorkspace && next === "wallet" && walletData) { setView("wallet"); if (!walletData.demo) writeLocation("wallet", walletData.wallet); }
  }

  const lookupForm = (
    <form onSubmit={submit} className="start-token-form">
      <ToggleGroup type="single" variant="outline" aria-label="Look up a token or a wallet" value={mode} disabled={busy}
        onValueChange={(next) => { if (next) selectMode(next as Mode); }} className="segmented-group lookup-mode">
        <ToggleGroupItem value="token"><Coins size={15} aria-hidden="true" />Token</ToggleGroupItem>
        <ToggleGroupItem value="wallet"><Wallet size={15} aria-hidden="true" />Wallet</ToggleGroupItem>
      </ToggleGroup>
      <Label htmlFor="lookup">{mode === "token" ? "Solana token address" : "Solana wallet address"}</Label>
      <div className="start-token-entry">
        <Input id="lookup" value={mode === "token" ? mint : walletInput}
          onChange={(event) => (mode === "token" ? setMint(event.target.value) : setWalletInput(event.target.value))}
          placeholder={mode === "token" ? "Paste a Solana token address" : "Paste a Solana wallet address"}
          spellCheck={false} autoComplete="off" required />
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <CircleNotch size={17} className="spin" aria-hidden="true" /> : null}
          {loading ? "Loading…" : auditing ? "Auditing…" : mode === "token" ? "Find traders" : "Open wallet"}
          {!busy && <ArrowRight size={16} weight="bold" aria-hidden="true" />}
        </Button>
      </div>
      {error && <p className="inline-alert danger" role="alert">{error}</p>}
      <div className="start-sample">
        <button type="button" onClick={loadDemo} disabled={busy}>Try a sample {mode === "token" ? "token" : "wallet"}</button>
        <span>No API key needed</span>
      </div>
    </form>
  );

  return (
    <main className={`app-shell pnl-shell ${!hasWorkspace ? "start-shell" : ""}`}>
      <a href={hasWorkspace ? "#results" : "#start"} className="skip-link">{hasWorkspace ? "Skip to results" : "Skip to lookup form"}</a>
      <header className={`app-header ${!hasWorkspace ? "start-header" : ""}`}>
        <ProductBrand />
        <FeatureSwitch active="pnl" />
        {hasWorkspace && <div className="project-title"><span className="header-divider" /><span>{view === "wallet" ? "Wallet overview" : `${data?.token.symbol ?? "Token"} traders`}</span><span className="status-badge">{(view === "wallet" ? walletData?.demo : data?.demo) ? "Sample" : "Workspace"}</span></div>}
        <div className="header-actions">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={connectionLabel} onClick={() => setKeyOpen(true)}><Key size={18} /><span className={`connection-dot ${needsKey ? "pending" : ""}`} /></Button></TooltipTrigger><TooltipContent>{connectionLabel}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </Button></TooltipTrigger><TooltipContent>Switch appearance</TooltipContent></Tooltip>
          {hasWorkspace && <Button variant="secondary" className="export-button" disabled={busy} onClick={() => { setView(null); setError(""); setMint(""); setWalletInput(""); const url = new URL(window.location.href); url.search = ""; window.history.pushState({}, "", url); }}><Plus size={16} /><span>New lookup</span></Button>}
        </div>
      </header>

      {!hasWorkspace ? <>
        <section id="start" className="start-workspace" aria-labelledby="start-title" tabIndex={-1}>
          <div className="start-content"><h1 id="start-title">Start your PnL story.</h1><p>Pick a wallet or token. Turn its trades into a replay.</p>{lookupForm}</div>
        </section>
        <footer className="start-footer">Powered by <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Birdeye Data</a><span>·</span>Solana</footer>
      </> : <div className="studio-layout pnl-layout">
        <nav className="tool-rail" aria-label="Workspace tools">
          <div className="pnl-tool-list">
            <button type="button" className="pnl-tool" aria-pressed={view === "token"} disabled={busy || !data} title={data ? undefined : "Open a token board from the wallet first"} onClick={() => selectMode("token")}><Coins size={22} /><span>Token</span></button>
            <button type="button" className="pnl-tool" aria-pressed={view === "wallet"} disabled={busy || !walletData} title={walletData ? undefined : "Click a wallet on the board first"} onClick={() => selectMode("wallet")}><Wallet size={22} /><span>Wallet</span></button>
          </div>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="rail-info" aria-label="About data and API usage" onClick={() => setUsageOpen(true)}><Info size={21} /></Button></TooltipTrigger><TooltipContent side="right">About & data usage</TooltipContent></Tooltip>
        </nav>
        <section id="results" className="results-workspace" aria-label="Lookup results" tabIndex={-1} aria-busy={loading}>
      {error && <p className="inline-alert danger workspace-error" role="alert">{error}</p>}
      {loading && (
        <section className="loading-grid" aria-live="polite" aria-label={mode === "token" ? "Loading board" : "Loading wallet"}>
          <div /><div /><div />
        </section>
      )}

      <div ref={resultsRef} className="results-anchor" />

      {view === "wallet" && walletData && !loading && (
        <>
          <nav className="view-crumbs" aria-label="Current view">
            <span><Wallet size={14} aria-hidden="true" /> Wallet</span>
            {data && (
              <Button type="button" variant="link" onClick={() => selectMode("token")}>
                Back to ${data.token.symbol ?? "token"} board
              </Button>
            )}
          </nav>
          <WalletView
            portfolio={walletData}
            loadingMore={loadingMore}
            openingMint={openingMint}
            onLoadMore={() => void loadMoreTokens()}
            onVideo={(token) => void openWalletVideo(token)}
            onTokenBoard={(tokenMint) => void loadToken(tokenMint, { demo: walletData.demo })}
          />

        </>
      )}

      {view === "token" && data && !loading && (
        <>
          {walletData && (
            <nav className="view-crumbs" aria-label="Current view">
              <span><Coins size={14} aria-hidden="true" /> Token</span>
              <Button type="button" variant="link" onClick={() => selectMode("wallet")}>
                Back to wallet {walletData.identity?.label ?? short(walletData.wallet)}
              </Button>
            </nav>
          )}
          <section className="token-header">
            <div className="token-identity">
              <TokenAvatar key={data.token.logo ?? data.token.mint} src={data.token.logo} symbol={data.token.symbol ?? "TOKEN"} />
              <div>
                <p className="token-symbol">${data.token.symbol ?? "TOKEN"}{data.demo ? <Badge variant="outline" className="pill neutral">Sample data</Badge> : null}</p>
                <h2>{data.token.name ?? short(data.token.mint)}</h2>
                {data.market && data.market.marketCapUsd > 0 && (
                  <p className="token-market">
                    MC {money(data.market.marketCapUsd)}
                    {data.market.holders > 0 ? ` · ${data.market.holders.toLocaleString("en-US")} holders` : ""}
                  </p>
                )}
                <code>{data.token.mint}</code>
              </div>
            </div>
            <div className="audit-summary">
              <p>Ledger confidence</p>
              <div className="audit-counts" aria-label="Audited wallets by confidence">
                <div><strong>{confidence.high}</strong><span>High</span></div>
                <div><strong>{confidence.medium}</strong><span>Medium</span></div>
                <div><strong>{confidence.low}</strong><span>Low</span></div>
              </div>
            </div>
          </section>
          {auditing && <div className="audit-progress" aria-live="polite">Board ready · auditing the leading wallet&apos;s ledger in the background…</div>}

          <PriceChart values={data.candles} />

          <section className="leaderboard">
            <div className="section-title">
              <h2>Trader board</h2>
              <p>Ranked by total PnL. A ledger replaces the Birdeye WAC row only when it can explain its inputs; opening a row&apos;s video builds that ledger. Click a wallet to see every token it traded.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Wallet</th><th>Method</th><th className="number">Invested</th><th className="number">Realized</th>
                    <th className="number">Unrealized</th><th className="number">Total PnL</th>
                    <th className="number">Δ vs WAC</th><th className="number">Trades</th><th className="clip-column"><span className="sr-only">Video</span></th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row, index) => (
                    <tr key={row.wallet}>
                      <td className="rank">{String(index + 1).padStart(2, "0")}</td>
                      <td className="wallet-cell">
                        {canOpenWallet(row.wallet) ? (
                          <button
                            type="button"
                            className="wallet-link"
                            onClick={() => void loadWallet(row.wallet, { demo: data.demo })}
                            title="Open this wallet: every token it traded"
                            aria-label={`Open wallet ${short(row.wallet)}`}
                          >
                            <WalletAvatar wallet={row.wallet} size={18} />
                            <code>{short(row.wallet)}</code>
                          </button>
                        ) : (
                          <code title={row.wallet}>{short(row.wallet)}</code>
                        )}
                        {row.tags?.slice(0, 2).map((tag) => <small key={tag}>{tag.replaceAll("_", " ")}</small>)}
                      </td>
                      <td><Confidence level={row.audit?.confidence} holderOnly={row.buys + row.sells === 0} /></td>
                      <td className="number">{row.boughtUsd > 0 ? money(row.boughtUsd) : "N/A"}</td>
                      <td className={`number ${row.realizedUsd < 0 ? "negative" : "positive"}`}>{money(row.realizedUsd, true)}</td>
                      <td className={`number ${row.unrealizedUsd < 0 ? "negative" : "positive"}`}>{money(row.unrealizedUsd, true)}</td>
                      <td className={`number total ${row.totalUsd < 0 ? "negative" : "positive"}`}>
                        {money(row.totalUsd, true)}
                        <MultiplePill investedUsd={row.boughtUsd} totalUsd={row.totalUsd} />
                      </td>
                      <td className="number delta">{row.audit ? money(row.audit.deltaUsd, true) : "N/A"}</td>
                      <td className="number">{(row.buys + row.sells).toLocaleString()}</td>
                      <td className="clip-column">
                        <Button type="button" variant="outline" size="sm" onClick={() => setVideoWallet(row.wallet)} aria-label={`Open PnL video for ${short(row.wallet)}`}>
                          <VideoCamera size={15} weight="bold" aria-hidden="true" /><span>Video</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>


        </>
      )}
      {!loading && (
        <footer className="results-footer">
          <span>Powered by <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Birdeye Data</a> · Solana</span>
          <button type="button" className="text-button" onClick={() => setUsageOpen(true)}><Info size={14} aria-hidden="true" />About & data usage</button>
        </footer>
      )}
        </section>
      </div>}
      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent className="studio-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); keyInputRef.current?.focus(); }}>
          <DialogHeader><DialogTitle>Connect to Birdeye</DialogTitle><DialogDescription>Your key gives this workspace access to real Solana wallet and token data.</DialogDescription></DialogHeader>
          <div className="field-stack"><Label htmlFor="api-key">Birdeye Data API key{serverKey && <span>Optional</span>}</Label>
            <Input id="api-key" ref={keyInputRef} type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setVisitorApiKey(event.target.value); }} placeholder={serverKey ? "Use your own key, or keep the app key" : "Paste your API key"} autoComplete="off" spellCheck={false} />
            <p className="field-hint">Kept in this tab’s memory only. Sent through this app’s server to Birdeye; never stored or logged.</p>
          </div>
          <a className="text-link" href="https://data.birdeye.so" target="_blank" rel="noreferrer">Get a Birdeye API key <ArrowRight size={14} /></a>
          <Button onClick={() => setKeyOpen(false)}><Check size={17} />Done</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}><DialogContent className="studio-dialog usage-dialog">
        <DialogHeader><DialogTitle>The data behind the story</DialogTitle><DialogDescription>Wallet PnL, trades, token prices and candles are provided by Birdeye Data API.</DialogDescription></DialogHeader>
        {(view === "wallet" ? walletData?.demo : data?.demo) && <p className="inline-alert"><Info size={16} />This workspace uses synthetic sample data.</p>}
        {activeUsage.length > 0 ? <UsagePanel passes={activeUsage} keySource={view === "wallet" ? walletData?.keySource : data?.keySource} /> : <p className="field-hint">Open live data to see request and compute-unit usage here.</p>}
        <a className="text-link" href="https://data.birdeye.so" target="_blank" rel="noreferrer">About Birdeye Data <ArrowRight size={14} /></a>
      </DialogContent></Dialog>
      {view === "token" && data && videoRow && (
        <WalletVideoModal
          key={`${data.token.mint}:${videoRow.wallet}`}
          data={data}
          row={videoRow}
          onClose={() => setVideoWallet(null)}
          onLedger={(audited) => setLedgerRows((rows) => ({ ...rows, [audited.wallet]: audited }))}
        />
      )}
      {view === "wallet" && walletVideo && (
        <WalletVideoModal
          key={`${walletVideo.data.token.mint}:${walletVideo.row.wallet}`}
          data={walletVideo.data}
          row={walletVideo.row}
          onClose={() => setWalletVideo(null)}
          onLedger={(audited) => setWalletLedgerRows((rows) => ({ ...rows, [`${walletVideo.data.token.mint}:${audited.wallet}`]: audited }))}
        />
      )}
    </main>
  );
}
