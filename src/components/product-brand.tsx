"use client";

import { ChartLineUp, Wallet, type Icon } from "@phosphor-icons/react";
import Link from "next/link";

export type Feature = "chart" | "pnl";

/** The two replays this product makes. Copy is shared by the picker and the header. */
export const FEATURES: Record<Feature, { href: string; label: string; short: string; title: string; blurb: string; input: string; icon: Icon }> = {
  chart: {
    href: "/chart",
    label: "Chart replay",
    short: "Chart",
    title: "Replay a token's chart",
    blurb: "Big trades, smart money, KOLs, snipers and the dev, marked on the candles as they print.",
    input: "Token mint",
    icon: ChartLineUp,
  },
  pnl: {
    href: "/pnl",
    label: "PnL replay",
    short: "PnL",
    title: "Replay a trader's PnL",
    blurb: "Every buy and sell of one wallet on the chart, with its PnL counting up to the result card.",
    input: "Wallet or token mint",
    icon: Wallet,
  },
};

/** Birdeye Data logomark, light variant: the mark always sits on the dark brand-ink tile. */
export function ProductMark() {
  return (
    <span className="product-mark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, shown unmodified */}
      <img className="product-logo" src="/brand/logos/Birdeye_Data_Logomark_Light.svg" alt="" width={19} height={22} />
    </span>
  );
}

export function ProductBrand() {
  return (
    <Link href="/" className="product-brand" aria-label="Birdeye Replayer home">
      <ProductMark />
      <span>Birdeye Replayer<span className="product-subtitle">Make the moment move.</span></span>
    </Link>
  );
}

/** Header switch between the two features; locked while a video renders. */
export function FeatureSwitch({ active, disabled = false }: { active: Feature; disabled?: boolean }) {
  return (
    <nav className="feature-switch" aria-label="Replay type">
      {(Object.keys(FEATURES) as Feature[]).map((feature) => {
        const { href, label, short, icon: FeatureIcon } = FEATURES[feature];
        const current = feature === active;
        return (
          <Link
            key={feature}
            href={href}
            aria-label={label}
            aria-current={current ? "page" : undefined}
            aria-disabled={disabled && !current ? true : undefined}
            tabIndex={disabled && !current ? -1 : undefined}
            onClick={(event) => {
              if (current || disabled) event.preventDefault();
            }}
          >
            <FeatureIcon size={15} weight={current ? "bold" : "regular"} aria-hidden="true" />
            <span>{short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
