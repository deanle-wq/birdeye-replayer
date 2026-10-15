"use client";

import { ArrowSquareOut, ChartLineUp, CircleNotch, Copy, VideoCamera } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  identityTags,
  viewTokens,
  type WalletFilter,
  type WalletPortfolio,
  type WalletSort,
  type WalletTokenRow,
} from "@/lib/wallet-portfolio";
import { money, MultiplePill, short, TokenAvatar, WalletAvatar } from "./shared";

const SORTS: Array<{ value: WalletSort; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "pnl", label: "Total PnL" },
  { value: "invested", label: "Invested" },
  { value: "value", label: "Value" },
];

function ago(timestamp?: number): string {
  if (!timestamp) return "N/A";
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000) - timestamp);
  if (seconds < 3_600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 86_400 * 60) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(timestamp * 1_000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function StatusPill({ token }: { token: WalletTokenRow }) {
  if (token.status === "held") return <Badge variant="outline" className="pill neutral" title="In the wallet with no trades on record">Held, no trades</Badge>;
  if (token.status === "holding") return <Badge variant="outline" className="pill high">Holding</Badge>;
  return <Badge variant="outline" className="pill neutral">Closed</Badge>;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "positive" | "negative" }) {
  return (
    <div className="wallet-stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export function WalletView({
  portfolio,
  loadingMore,
  openingMint,
  onLoadMore,
  onVideo,
  onTokenBoard,
}: {
  portfolio: WalletPortfolio;
  loadingMore: boolean;
  /** Mint whose chart is loading for the video editor. */
  openingMint: string | null;
  onLoadMore: () => void;
  onVideo: (token: WalletTokenRow) => void;
  onTokenBoard: (mint: string) => void;
}) {
  const [filter, setFilter] = useState<WalletFilter>("all");
  const [sort, setSort] = useState<WalletSort>("recent");
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => viewTokens(portfolio.tokens, filter, sort), [filter, portfolio.tokens, sort]);
  const counts = useMemo(() => ({
    all: portfolio.tokens.length,
    holding: portfolio.tokens.filter((token) => token.status !== "closed").length,
    closed: portfolio.tokens.filter((token) => token.status === "closed").length,
  }), [portfolio.tokens]);
  const { summary, identity } = portfolio;
  const recentOnly = portfolio.historyWindow === "90d";
  // The label is the title; the badges carry the rest.
  const tags = identityTags(identity).filter((tag) => tag !== identity?.label);
  const title = identity?.label ?? short(portfolio.wallet);

  return (
    <>
      <section className="token-header wallet-header">
        <div className="token-identity">
          <WalletAvatar wallet={portfolio.wallet} size={56} />
          <div>
            <p className="token-symbol">
              Wallet
              {portfolio.demo ? <Badge variant="outline" className="pill neutral">Sample data</Badge> : null}
              {tags.map((tag) => <Badge key={tag} variant="outline" className="pill neutral">{tag.replaceAll("_", " ")}</Badge>)}
            </p>
            <h2>{title}</h2>
            <p className="wallet-address">
              <code>{portfolio.wallet}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Copy wallet address"
                onClick={() => {
                  void navigator.clipboard?.writeText(portfolio.wallet).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1_200);
                  });
                }}
              >
                <Copy size={14} aria-hidden="true" />
              </Button>
              <span className="copy-note" aria-live="polite">{copied ? "Copied" : ""}</span>
              <a href={`https://birdeye.so/solana/profile/${portfolio.wallet}`} target="_blank" rel="noreferrer" className="external-link">
                Birdeye profile <ArrowSquareOut size={13} aria-hidden="true" />
              </a>
            </p>
          </div>
        </div>
      </section>

      {recentOnly && (
        <p className="inline-alert wallet-window-note" role="status">
          Birdeye could not compute this wallet&apos;s all-time PnL, so every number below covers the last 90 days.
        </p>
      )}
      <section className="wallet-stats" aria-label="Wallet PnL summary">
        <Stat
          label="Total PnL"
          tone={summary.totalUsd < 0 ? "negative" : "positive"}
          value={<>{money(summary.totalUsd, true)}<MultiplePill investedUsd={summary.investedUsd} totalUsd={summary.totalUsd} /></>}
        />
        <Stat label="Realized" tone={summary.realizedUsd < 0 ? "negative" : "positive"} value={money(summary.realizedUsd, true)} />
        <Stat label="Unrealized" tone={summary.unrealizedUsd < 0 ? "negative" : "positive"} value={money(summary.unrealizedUsd, true)} />
        <Stat label="Invested" value={money(summary.investedUsd)} />
        <Stat label="Win rate" value={`${Math.round(summary.winRate * 100)}% · ${summary.wins}W ${summary.losses}L`} />
        <Stat label="Portfolio value" value={money(summary.valueUsd)} />
      </section>
      <p className="wallet-note">
        Birdeye Wallet PnL (WAC) across {summary.tokens.toLocaleString()} tokens and {(summary.buys + summary.sells).toLocaleString()} trades, {recentOnly ? "last 90 days" : "all-time"}.
        {portfolio.hiddenQuoteAssets > 0 ? ` The list hides ${portfolio.hiddenQuoteAssets} quote asset${portfolio.hiddenQuoteAssets > 1 ? "s" : ""} (SOL, USDC, USDT…): they are the other leg of each swap, not a trade.` : ""}
      </p>

      <section className="leaderboard wallet-tokens">
        <div className="section-title wallet-toolbar">
          <div>
            <h2>Tokens</h2>
            <p>Every token this wallet traded or holds. Open a video to replay its fills on that token, or jump to the token&apos;s trader board.</p>
          </div>
          <div className="wallet-controls">
            <ToggleGroup type="single" variant="outline" size="sm" aria-label="Filter tokens" value={filter} onValueChange={(value) => value && setFilter(value as WalletFilter)} className="segmented-group wallet-filter">
              <ToggleGroupItem value="all">All <span className="filter-count">{counts.all}</span></ToggleGroupItem>
              <ToggleGroupItem value="holding">Holding <span className="filter-count">{counts.holding}</span></ToggleGroupItem>
              <ToggleGroupItem value="closed">Closed <span className="filter-count">{counts.closed}</span></ToggleGroupItem>
            </ToggleGroup>
            <label className="sort-select">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as WalletSort)} aria-label="Sort tokens">
                {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th><th>Status</th><th className="number">Invested</th><th className="number">Realized</th>
                <th className="number">Unrealized</th><th className="number">Total PnL</th><th className="number">Value</th>
                <th className="number">Trades</th><th className="number">Last trade</th><th className="clip-column"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((token) => {
                const traded = token.buys + token.sells > 0;
                return (
                  <tr key={token.mint}>
                    <td>
                      <span className="token-cell">
                        <TokenAvatar key={token.logo ?? token.mint} src={token.logo} symbol={token.symbol} size={32} />
                        <span>
                          <b>${token.symbol}</b>
                          <small title={token.mint}>{token.name ?? short(token.mint)}</small>
                        </span>
                      </span>
                    </td>
                    <td><StatusPill token={token} /></td>
                    <td className="number">{token.investedUsd > 0 ? money(token.investedUsd) : "N/A"}</td>
                    <td className={`number ${token.realizedUsd < 0 ? "negative" : "positive"}`}>{traded ? money(token.realizedUsd, true) : "N/A"}</td>
                    <td className={`number ${token.unrealizedUsd < 0 ? "negative" : "positive"}`}>{traded ? money(token.unrealizedUsd, true) : "N/A"}</td>
                    <td className={`number total ${token.totalUsd < 0 ? "negative" : "positive"}`}>
                      {traded ? money(token.totalUsd, true) : "N/A"}
                      <MultiplePill investedUsd={token.investedUsd} totalUsd={token.totalUsd} />
                    </td>
                    <td className="number">{token.valueUsd >= 1 ? money(token.valueUsd) : "N/A"}</td>
                    <td className="number">{traded ? (token.buys + token.sells).toLocaleString() : "0"}</td>
                    <td className="number">{ago(token.lastTradeAt)}</td>
                    <td className="clip-column">
                      <span className="row-actions">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onVideo(token)}
                          disabled={openingMint !== null}
                          aria-label={`Open PnL video for $${token.symbol}`}
                        >
                          {openingMint === token.mint ? <CircleNotch size={15} className="animate-spin" aria-hidden="true" /> : <VideoCamera size={15} weight="bold" aria-hidden="true" />}
                          <span>Video</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onTokenBoard(token.mint)}
                          aria-label={`Open the trader board for $${token.symbol}`}
                          title="Trader board for this token"
                        >
                          <ChartLineUp size={15} weight="bold" aria-hidden="true" /><span>Board</span>
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="empty-row">No tokens match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {portfolio.nextOffset !== null && (
          <div className="load-more">
            <Button type="button" variant="outline" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load the next 100 tokens"}
            </Button>
            <span>{portfolio.tokens.length.toLocaleString()} loaded of about {summary.tokens.toLocaleString()} (newest trades first)</span>
          </div>
        )}
      </section>
    </>
  );
}
