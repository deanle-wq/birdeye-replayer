"use client";

import { ArrowRight, Moon, Sun } from "@phosphor-icons/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/use-theme";
import { FEATURES, ProductBrand, type Feature } from "./product-brand";

/** The front door: pick the replay first, then each feature asks for its address. */
export function FeaturePicker({ mint }: { mint?: string }) {
  const [theme, setTheme] = useTheme();
  const query = mint ? `?mint=${encodeURIComponent(mint)}` : "";

  return (
    <main className="app-shell start-shell">
      <a href="#start" className="skip-link">Skip to replay types</a>
      <header className="app-header start-header">
        <ProductBrand />
        <div className="header-actions">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </Button></TooltipTrigger><TooltipContent>Switch appearance</TooltipContent></Tooltip>
        </div>
      </header>
      <section id="start" className="start-workspace" aria-labelledby="start-title" tabIndex={-1}>
        <div className="start-content picker-content">
          <h1 id="start-title">What do you want to replay?</h1>
          <p>Pick a replay. Then paste an address.</p>
          <div className="feature-cards">
            {(Object.keys(FEATURES) as Feature[]).map((feature) => {
              const { href, label, title, blurb, input, icon: FeatureIcon } = FEATURES[feature];
              return (
                <Link key={feature} href={`${href}${query}`} className="feature-card">
                  <span className="feature-card-icon" aria-hidden="true"><FeatureIcon size={24} weight="bold" /></span>
                  <span className="eyebrow">{label.toUpperCase()}</span>
                  <strong>{title}</strong>
                  <span className="feature-card-blurb">{blurb}</span>
                  <span className="feature-card-foot"><span>{input}</span><ArrowRight size={16} weight="bold" aria-hidden="true" /></span>
                </Link>
              );
            })}
          </div>
          {mint && <p className="picker-note">Token {mint.slice(0, 5)}…{mint.slice(-4)} carries over to either replay.</p>}
        </div>
      </section>
      <footer className="start-footer">Powered by <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Birdeye Data</a><span>·</span>Solana</footer>
    </main>
  );
}
