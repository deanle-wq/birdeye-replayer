"use client";

import { ArrowRight, Brain, Code, Crosshair, Microphone, Wallet, type Icon } from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TagLayer } from "@/lib/chart-tags";

export function Segmented<T extends string>({ label, options, value, onChange, disabled, render, isDisabled }: {
  label: string; options: readonly T[]; value: T | null; onChange: (value: T) => void;
  disabled?: boolean; render?: (value: T) => string; isDisabled?: (value: T) => boolean;
}) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" aria-label={label} value={value ?? ""} onValueChange={(next) => next && onChange(next as T)} disabled={disabled} className="segmented-group">
      {options.map((option) => <ToggleGroupItem key={option} value={option} disabled={isDisabled?.(option)}>{render ? render(option) : option}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

export function SwitchField({ id, label, checked, onChange, disabled }: {
  id: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <div className="switch-field"><Label htmlFor={id}>{label}</Label><Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} /></div>;
}

const LAYER_ICONS: Record<TagLayer, Icon> = { big: Wallet, smart_trader: Brain, kol: Microphone, sniper: Crosshair, dev: Code };
export function LayerIcon({ layer, size = 19 }: { layer: TagLayer; size?: number }) {
  const IconComponent = LAYER_ICONS[layer];
  return <IconComponent size={size} aria-hidden="true" />;
}

export const LAYER_DESCRIPTIONS: Record<TagLayer, string> = {
  big: "Individual swaps above your threshold.", smart_trader: "Top-performing, non-bot wallets.",
  kol: "Tracked key opinion leaders.", sniper: "Buyers in the first five blocks.", dev: "The token creator’s wallet.",
};

export function TokenForm({ mint, onMintChange, onSubmit, onSample, onConnection, loading, alreadyLoaded = false, needsKey, error, variant = "editor" }: {
  mint: string; onMintChange: (value: string) => void; onSubmit: (event: FormEvent) => void;
  onSample: () => void; onConnection: () => void; loading: boolean; alreadyLoaded?: boolean; needsKey: boolean; error: string; variant?: "start" | "editor";
}) {
  const sameTitle = alreadyLoaded ? "Already showing this token. Paste another mint to load it." : undefined;
  if (variant === "start") return <form onSubmit={onSubmit} className="start-token-form" aria-busy={loading}>
    <Label htmlFor="mint">Solana token address</Label>
    <div className="start-token-entry">
      <Input id="mint" value={mint} onChange={(event) => onMintChange(event.target.value)} placeholder="Paste a token mint address" spellCheck={false} autoComplete="off" required disabled={loading} aria-describedby={error ? "token-error" : undefined} />
      <Button type="submit" variant="secondary" disabled={loading || alreadyLoaded} title={sameTitle}>{loading ? "Loading token…" : "Create replay"}<ArrowRight size={17} /></Button>
    </div>
    {error && <p id="token-error" className="inline-alert danger" role="alert">{error}</p>}
    <div className="start-sample"><button type="button" onClick={onSample} disabled={loading}>Try a sample replay</button><span>No API key needed</span></div>
  </form>;
  return <form onSubmit={onSubmit} className="token-form">
    <Label htmlFor="mint">Solana token address</Label>
    <Input id="mint" value={mint} onChange={(event) => onMintChange(event.target.value)} placeholder="Paste a token mint address" spellCheck={false} autoComplete="off" required disabled={loading} />
    <p className="field-hint">Start with a token. We’ll load its history so you can choose the moment.</p>
    {needsKey && <button type="button" className="connection-prompt" onClick={onConnection}>Connect your Birdeye API key <ArrowRight size={14} /></button>}
    <Button type="submit" disabled={loading || alreadyLoaded} title={sameTitle}>{loading ? "Loading token…" : "Load token"}<ArrowRight size={16} /></Button>
    {error && <p className="inline-alert danger" role="alert">{error}</p>}
    <div className="form-divider"><span>or explore first</span></div>
    <Button type="button" variant="outline" onClick={onSample} disabled={loading}>Try a sample token</Button>
    <p className="field-hint centered">Sample data · no API key needed</p>
  </form>;
}
