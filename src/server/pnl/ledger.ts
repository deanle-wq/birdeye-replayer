import type {
  BirdeyeBalanceChange,
  BirdeyeTrade,
  BirdeyeTransfer,
} from "../birdeye/types";

export type LedgerEventKind = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface LedgerEvent {
  signature: string;
  timestamp: number;
  kind: LedgerEventKind;
  quantity: number;
  priceUsd: number;
  valueUsd: number;
  exactExecution: boolean;
  settlementSymbol?: "USDC" | "SOL";
  settlementAmount?: number;
  source?: string;
  counterparty?: string;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function movementAmount(movement: NonNullable<BirdeyeTrade["from"]>): number {
  return Math.abs(finite(movement.ui_change_amount) || finite(movement.ui_amount) || finite(movement.amount));
}

function settlementForTrade(trade: BirdeyeTrade, mint: string) {
  const candidates = [trade.from, trade.to, trade.base, trade.quote, ...(trade.tokens ?? [])]
    .filter((movement): movement is NonNullable<BirdeyeTrade["from"]> => movement !== undefined)
    .filter((movement) => movement.address !== mint);
  const settlement = candidates.find((movement) =>
    movement.address === SOL_MINT || movement.address === USDC_MINT || movement.symbol?.toUpperCase() === "SOL" || movement.symbol?.toUpperCase() === "USDC",
  );
  if (!settlement) return {};
  const symbol = settlement.address === SOL_MINT || settlement.symbol?.toUpperCase() === "SOL" ? "SOL" : "USDC";
  return { settlementSymbol: symbol as "USDC" | "SOL", settlementAmount: movementAmount(settlement) };
}

/** Build visual trade events without balance reconciliation. Used for sampled video replay only. */
export function buildTradeReplayEvents(trades: BirdeyeTrade[], mint: string): LedgerEvent[] {
  const bySignature = new Map<string, LedgerEvent>();
  for (const trade of trades) {
    const token = legs(trade).find((movement) => movement.address === mint);
    if (!token) continue;
    const signedQuantity = finite(token.ui_change_amount);
    const side = trade.side?.toLowerCase();
    const kind = side === "buy" || side === "sell"
      ? side
      : signedQuantity < 0
        ? "sell"
        : "buy";
    const quantity = Math.abs(signedQuantity || finite(token.ui_amount) || finite(token.amount));
    if (!(quantity > 0)) continue;
    const valueUsd = finite(trade.volume_usd) || quantity * (finite(token.price) || finite(token.nearest_price));
    const candidate: LedgerEvent = {
      signature: trade.tx_hash,
      timestamp: trade.block_unix_time,
      kind,
      quantity,
      priceUsd: valueUsd > 0 ? valueUsd / quantity : finite(token.price) || finite(token.nearest_price),
      valueUsd,
      exactExecution: true,
      ...settlementForTrade(trade, mint),
      source: trade.source,
    };
    const held = bySignature.get(trade.tx_hash);
    if (!held || candidate.valueUsd > held.valueUsd) bySignature.set(trade.tx_hash, candidate);
  }
  return [...bySignature.values()].sort((a, b) => a.timestamp - b.timestamp || a.signature.localeCompare(b.signature));
}

export interface LedgerResult {
  quantity: number;
  paidQuantity: number;
  unknownQuantity: number;
  costBasisUsd: number;
  boughtUsd: number;
  soldUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  buys: number;
  sells: number;
  transfersIn: number;
  transfersOut: number;
  unresolvedBasisOutUsd: number;
  exactExecutionRatio: number;
  unknownBasisRatio: number;
  events: LedgerEvent[];
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scaledDelta(change: BirdeyeBalanceChange): number {
  const decimals = change.token_info?.decimals ?? 0;
  const multiplier = change.token_info?.multiplier ?? 1;
  const raw = finite(change.post_balance) - finite(change.pre_balance);
  return (raw / 10 ** decimals) * multiplier;
}

function legs(trade: BirdeyeTrade) {
  return [trade.base, trade.quote, trade.from, trade.to, ...(trade.tokens ?? [])].filter(
    (leg): leg is NonNullable<typeof leg> => Boolean(leg),
  );
}

function tradePrice(trade: BirdeyeTrade, mint: string): { price: number; weight: number } | null {
  const leg = legs(trade).find((item) => item.address === mint);
  if (!leg) return null;
  const quantity = Math.abs(finite(leg.ui_change_amount) || finite(leg.ui_amount));
  const execution = quantity > 0 ? finite(trade.volume_usd) / quantity : 0;
  const price = execution || finite(leg.price) || finite(leg.nearest_price);
  return price > 0 ? { price, weight: quantity || 1 } : null;
}

/**
 * Birdeye balance changes are the quantity source of truth. Decoded trades
 * only classify the movement and provide execution price. This prevents a
 * routed swap from multiplying the wallet position when several inner swaps
 * describe one net wallet balance change.
 */
export function buildLedgerEvents(input: {
  mint: string;
  balanceChanges: BirdeyeBalanceChange[];
  trades: BirdeyeTrade[];
  transfers?: BirdeyeTransfer[];
  fallbackPrice?: (timestamp: number) => number;
}): LedgerEvent[] {
  const changes = new Map<
    string,
    { quantity: number; timestamp: number; rows: BirdeyeBalanceChange[] }
  >();
  for (const row of input.balanceChanges) {
    if (row.token_info?.address && row.token_info.address !== input.mint) continue;
    const held = changes.get(row.tx_hash) ?? {
      quantity: 0,
      timestamp: row.block_unix_time,
      rows: [],
    };
    held.quantity += scaledDelta(row);
    held.timestamp = Math.min(held.timestamp || row.block_unix_time, row.block_unix_time);
    held.rows.push(row);
    changes.set(row.tx_hash, held);
  }

  const tradesBySignature = new Map<string, BirdeyeTrade[]>();
  const seenTrade = new Set<string>();
  for (const trade of input.trades) {
    const instruction = `${trade.tx_hash}:${trade.ins_index ?? -1}:${trade.inner_ins_index ?? -1}`;
    if (seenTrade.has(instruction)) continue;
    seenTrade.add(instruction);
    // A decoded swap without a USD price is still a swap: it classifies the
    // balance change and falls back to OHLCV for price, rather than turning a
    // paid buy into unknown-basis transfer inventory.
    if (!legs(trade).some((leg) => leg.address === input.mint)) continue;
    const list = tradesBySignature.get(trade.tx_hash) ?? [];
    list.push(trade);
    tradesBySignature.set(trade.tx_hash, list);
  }

  const transferBySignature = new Map<string, BirdeyeTransfer>();
  for (const transfer of input.transfers ?? []) {
    if (transfer.token_address === input.mint) transferBySignature.set(transfer.tx_hash, transfer);
  }

  const events: LedgerEvent[] = [];
  for (const [signature, change] of changes) {
    if (Math.abs(change.quantity) < 1e-15) continue;
    const matched = tradesBySignature.get(signature) ?? [];
    let weightedPrice = 0;
    let totalWeight = 0;
    for (const trade of matched) {
      const candidate = tradePrice(trade, input.mint);
      if (!candidate) continue;
      weightedPrice += candidate.price * candidate.weight;
      totalWeight += candidate.weight;
    }
    const executionPrice = totalWeight > 0 ? weightedPrice / totalWeight : 0;
    const transfer = transferBySignature.get(signature);
    const fallback = input.fallbackPrice?.(change.timestamp) ?? finite(transfer?.price);
    const traded = matched.length > 0;
    const price = executionPrice || fallback || 0;
    const quantity = Math.abs(change.quantity);
    const settlement = matched.map((trade) => settlementForTrade(trade, input.mint)).find((item) => item.settlementAmount);

    events.push({
      signature,
      timestamp: change.timestamp,
      kind: traded
        ? change.quantity > 0
          ? "buy"
          : "sell"
        : change.quantity > 0
          ? "transfer_in"
          : "transfer_out",
      quantity,
      priceUsd: price,
      valueUsd: quantity * price,
      exactExecution: executionPrice > 0,
      ...settlement,
      source: matched[0]?.source,
      counterparty:
        transfer?.flow === "in" ? transfer.from_address : transfer?.to_address,
    });
  }

  return events.sort(
    (a, b) => a.timestamp - b.timestamp || a.signature.localeCompare(b.signature),
  );
}

/** Weighted-average-cost ledger with unknown inventory kept out of PnL. */
export function calculateLedger(events: LedgerEvent[], spotPriceUsd: number): LedgerResult {
  let quantity = 0;
  let paidQuantity = 0;
  let unknownQuantity = 0;
  let costBasisUsd = 0;
  let boughtUsd = 0;
  let totalBoughtQuantity = 0;
  let soldUsd = 0;
  let realizedUsd = 0;
  let unresolvedBasisOutUsd = 0;
  let buys = 0;
  let sells = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let tradedQuantity = 0;
  let exactQuantity = 0;
  let unknownBasisLifetime = 0;

  for (const event of events) {
    if (event.kind === "buy") {
      quantity += event.quantity;
      paidQuantity += event.quantity;
      costBasisUsd += event.valueUsd;
      boughtUsd += event.valueUsd;
      totalBoughtQuantity += event.quantity;
      buys += 1;
      tradedQuantity += event.quantity;
      if (event.exactExecution) exactQuantity += event.quantity;
      continue;
    }

    if (event.kind === "transfer_in") {
      quantity += event.quantity;
      unknownQuantity += event.quantity;
      unknownBasisLifetime += event.quantity;
      transfersIn += 1;
      continue;
    }

    const removable = Math.min(event.quantity, Math.max(quantity, 0));
    const unknownShare = quantity > 0 ? unknownQuantity / quantity : 1;
    const unknownRemoved = Math.min(unknownQuantity, removable * unknownShare);
    const paidRemoved = Math.min(paidQuantity, removable - unknownRemoved);
    const averageCost = paidQuantity > 0 ? costBasisUsd / paidQuantity : 0;
    const basisRemoved = averageCost * paidRemoved;

    quantity -= removable;
    unknownQuantity -= unknownRemoved;
    paidQuantity -= paidRemoved;
    costBasisUsd -= basisRemoved;

    if (event.kind === "sell") {
      const paidFraction = event.quantity > 0 ? paidRemoved / event.quantity : 0;
      const confirmedProceeds = event.valueUsd * paidFraction;
      realizedUsd += confirmedProceeds - basisRemoved;
      soldUsd += confirmedProceeds;
      sells += 1;
      tradedQuantity += event.quantity;
      if (event.exactExecution) exactQuantity += event.quantity;
    } else {
      unresolvedBasisOutUsd += basisRemoved;
      transfersOut += 1;
    }

    const unmatched = event.quantity - removable;
    if (unmatched > 1e-12) {
      // The visible history starts after inventory arrived or coverage is incomplete.
      unknownBasisLifetime += unmatched;
    }
  }

  quantity = Math.max(0, quantity);
  paidQuantity = Math.max(0, paidQuantity);
  unknownQuantity = Math.max(0, unknownQuantity);
  costBasisUsd = Math.max(0, costBasisUsd);
  const unrealizedUsd = paidQuantity * spotPriceUsd - costBasisUsd;
  const totalUsd = realizedUsd + unrealizedUsd;
  const acquired = totalBoughtQuantity + unknownBasisLifetime;

  return {
    quantity,
    paidQuantity,
    unknownQuantity,
    costBasisUsd,
    boughtUsd,
    soldUsd,
    realizedUsd,
    unrealizedUsd,
    totalUsd,
    buys,
    sells,
    transfersIn,
    transfersOut,
    unresolvedBasisOutUsd,
    exactExecutionRatio: tradedQuantity > 0 ? exactQuantity / tradedQuantity : 0,
    unknownBasisRatio: acquired > 0 ? unknownBasisLifetime / acquired : 0,
    events,
  };
}
