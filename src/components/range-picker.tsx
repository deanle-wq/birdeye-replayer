"use client";

import { useMemo, useRef, useState } from "react";
import {
  clampRange,
  formatMoment,
  formatSpan,
  fromInputValue,
  moveEdge,
  panRange,
  toInputValue,
  type TimeRange,
} from "@/lib/range";
import type { BirdeyeCandle } from "@/server/birdeye/types";

const WIDTH = 1_000;
const HEIGHT = 132;

type Drag =
  | { kind: "from" | "to" }
  | { kind: "pan"; startX: number; start: TimeRange }
  | { kind: "new"; anchor: number };

/**
 * The whole history as a small area chart with a window over it. Drag the
 * handles to resize, drag inside to move, drag on empty chart to draw a new
 * window; arrow keys nudge the focused handle (Shift for bigger steps).
 */
export function RangePicker({
  history,
  bounds,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  history: BirdeyeCandle[];
  bounds: TimeRange;
  value: TimeRange;
  /** `final` is false while dragging, true when the gesture ends. */
  onChange: (range: TimeRange, final: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const span = Math.max(1, bounds.to - bounds.from);
  const xOf = (time: number) => ((time - bounds.from) / span) * WIDTH;

  const { area, line } = useMemo(() => {
    if (history.length < 2) return { area: "", line: "" };
    const closes = history.map((candle) => Math.max(candle.c, 1e-18));
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // Memecoin histories span orders of magnitude: a log scale keeps the early chart visible.
    const log = max / min > 20;
    const scale = (value: number) => (log ? Math.log(value) : value);
    const lo = scale(min);
    const hi = scale(max);
    const points = history.map((candle) => {
      const x = ((candle.unixTime - bounds.from) / span) * WIDTH;
      const y = HEIGHT - 8 - ((scale(Math.max(candle.c, 1e-18)) - lo) / Math.max(hi - lo, 1e-12)) * (HEIGHT - 20);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: points.join(" "), area: `0,${HEIGHT} ${points.join(" ")} ${WIDTH},${HEIGHT}` };
  }, [bounds.from, history, span]);

  const timeAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return bounds.from;
    return bounds.from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span;
  };

  const startDrag = (event: React.PointerEvent, next: Drag) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    // Capture keeps the drag alive off the element; it can throw for a pointer
    // that is already gone, which must not cancel the drag itself.
    try {
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    } catch {
      // Dragging still works while the pointer stays over the chart.
    }
    setDrag(next);
  };

  const onMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const time = timeAt(event.clientX);
    if (drag.kind === "pan") onChange(panRange(drag.start, time - timeAt(drag.startX), bounds), false);
    else if (drag.kind === "new") onChange(clampRange({ from: Math.min(drag.anchor, time), to: Math.max(drag.anchor, time) }, bounds), false);
    else onChange(moveEdge(value, drag.kind, time, bounds), false);
  };

  const endDrag = () => {
    if (!drag) return;
    setDrag(null);
    onChange(value, true);
  };

  const nudge = (edge: "from" | "to") => (event: React.KeyboardEvent) => {
    const step = span * (event.shiftKey ? 0.05 : 0.005);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(moveEdge(value, edge, value[edge] + delta, bounds), true);
  };

  const left = xOf(value.from);
  const right = xOf(value.to);

  return (
    <div className={`range-picker ${compact ? "compact" : ""}`}>
      <div className="brush-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className={`brush ${drag ? "dragging" : ""}`}
          onPointerDown={(event) => startDrag(event, { kind: "new", anchor: timeAt(event.clientX) })}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label="Token history; drag to choose the replay window"
        >
          <defs>
            <linearGradient id="brush-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--focus)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--focus)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <polygon points={area} fill="url(#brush-fill)" />}
          {line && <polyline points={line} fill="none" stroke="var(--focus)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          <rect x={0} y={0} width={Math.max(0, left)} height={HEIGHT} className="brush-shade" />
          <rect x={right} y={0} width={Math.max(0, WIDTH - right)} height={HEIGHT} className="brush-shade" />
          <rect
            x={left}
            y={1}
            width={Math.max(2, right - left)}
            height={HEIGHT - 2}
            className="brush-window"
            onPointerDown={(event) => startDrag(event, { kind: "pan", startX: event.clientX, start: value })}
          />
        </svg>
        {(["from", "to"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            role="slider"
            aria-label={edge === "from" ? "Window start" : "Window end"}
            aria-valuemin={bounds.from}
            aria-valuemax={bounds.to}
            aria-valuenow={value[edge]}
            aria-valuetext={formatMoment(value[edge])}
            className="brush-handle"
            style={{ left: `${((edge === "from" ? left : right) / WIDTH) * 100}%` }}
            disabled={disabled}
            onPointerDown={(event) => startDrag(event, { kind: edge })}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={nudge(edge)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="range-inputs">
        <label>
          <span>From (UTC)</span>
          <input
            type="datetime-local"
            value={toInputValue(value.from)}
            min={toInputValue(bounds.from)}
            max={toInputValue(bounds.to)}
            disabled={disabled}
            onChange={(event) => {
              const next = fromInputValue(event.target.value);
              if (next !== null) {
                            onChange(moveEdge(value, "from", next, bounds), true);
              }
            }}
          />
        </label>
        <span className="range-span">{formatSpan(value.to - value.from)}</span>
        <label>
          <span>To (UTC)</span>
          <input
            type="datetime-local"
            value={toInputValue(value.to)}
            min={toInputValue(bounds.from)}
            max={toInputValue(bounds.to)}
            disabled={disabled}
            onChange={(event) => {
              const next = fromInputValue(event.target.value);
              if (next !== null) {
                            onChange(moveEdge(value, "to", next, bounds), true);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
