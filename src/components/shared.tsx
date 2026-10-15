"use client";

import { Code } from "@phosphor-icons/react";
import { useState } from "react";
import { identicon } from "@/lib/identicon";
import { logoCandidates } from "@/lib/token-logo";
import { formatMultiple } from "@/lib/wallet-tags";
import type { ApiUsage } from "@/server/birdeye/usage";

/** Building blocks shared by the token board and the wallet view. */

export function money(value: number, signed = false) {
  const body = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : Math.abs(value) >= 1_000_000 ? 2 : 0,
  }).format(Math.abs(value || 0));
  if (!signed) return value < 0 ? `−${body}` : body;
  return `${value < 0 ? "−" : "+"}${body}`;
}

/** Token logo from Birdeye metadata, trying each source in turn, or a monogram. */
export function TokenAvatar({ src, symbol, size = 56 }: { src?: string; symbol: string; size?: number }) {
  const [attempt, setAttempt] = useState(0);
  const url = logoCandidates(src)[attempt];
  if (!url) {
    return <span className="token-avatar monogram" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{symbol.replace(/[^a-z0-9]/gi, "")[0]?.toUpperCase() ?? "?"}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts, shown as-is
  return <img className="token-avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" onError={() => setAttempt((value) => value + 1)} />;
}

/** (invested + PnL) / invested, as on the video card. */
export function MultiplePill({ investedUsd, totalUsd }: { investedUsd: number; totalUsd: number }) {
  const text = investedUsd > 0 ? formatMultiple((investedUsd + totalUsd) / investedUsd) : null;
  if (!text) return null;
  return <span className={`multiple-pill ${totalUsd < 0 ? "loss" : "win"}`}>{text}</span>;
}

/** The wallet's identicon, the same face its videos use. */
export function WalletAvatar({ wallet, size = 40 }: { wallet: string; size?: number }) {
  const face = identicon(wallet);
  return (
    <svg className="wallet-avatar" width={size} height={size} viewBox="0 0 6 6" aria-hidden="true">
      <clipPath id={`wa-${wallet.slice(0, 8)}`}><circle cx="3" cy="3" r="3" /></clipPath>
      <g clipPath={`url(#wa-${wallet.slice(0, 8)})`}>
        <rect width="6" height="6" fill={face.background} />
        {face.cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={0.5 + x} y={0.5 + y} width="1.02" height="1.02" fill={face.foreground} /> : null)))}
      </g>
    </svg>
  );
}

export function short(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function UsagePanel({ passes, keySource }: { passes: Array<{ label: string; usage: ApiUsage }>; keySource?: "visitor" | "server" }) {
  if (passes.length === 0) return null;
  const endpoints = new Map<string, { requests: number; cu: number }>();
  for (const pass of passes) {
    for (const item of pass.usage.endpoints) {
      const held = endpoints.get(item.path) ?? { requests: 0, cu: 0 };
      held.requests += item.requests;
      held.cu += item.cu;
      endpoints.set(item.path, held);
    }
  }
  const totalCu = passes.reduce((sum, pass) => sum + pass.usage.cu, 0);
  const totalRequests = passes.reduce((sum, pass) => sum + pass.usage.requests, 0);
  const cached = passes.reduce((sum, pass) => sum + pass.usage.cacheHits, 0);
  return (
    <section className="usage-panel" aria-label="Birdeye Data API usage">
      <div className="section-title">
        <h2><Code size={18} aria-hidden="true" /> Built on Birdeye Data API</h2>
        <p>{totalRequests.toLocaleString()} billable requests · {totalCu.toLocaleString()} CU{cached ? ` · ${cached.toLocaleString()} served from cache` : ""}{keySource ? `, billed to ${keySource === "visitor" ? "your key" : "this app's key"}` : ""}. CU per Birdeye&apos;s published compute-unit table.</p>
      </div>
      <div className="table-wrap">
        <table className="usage-table">
          <thead>
            <tr><th>Endpoint</th><th className="number">Requests</th><th className="number">CU</th></tr>
          </thead>
          <tbody>
            {[...endpoints].sort((a, b) => b[1].cu - a[1].cu).map(([path, item]) => (
              <tr key={path}>
                <td><code>{path}</code></td>
                <td className="number">{item.requests.toLocaleString()}</td>
                <td className="number">{item.cu.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="usage-note">{passes.map((pass) => `${pass.label}: ${pass.usage.requests} requests, ${pass.usage.cu.toLocaleString()} CU`).join(" · ")}</p>
    </section>
  );
}
