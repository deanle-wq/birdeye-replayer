export interface BirdeyeAssetMovement {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  amount?: number | string;
  ui_amount?: number;
  ui_change_amount?: number;
  price?: number | null;
  nearest_price?: number | null;
  change_amount?: number | string;
  type?: string;
  type_swap?: string;
}

export interface BirdeyeTrade {
  tx_hash: string;
  tx_type?: string;
  side?: string;
  ins_index?: number | null;
  inner_ins_index?: number | null;
  block_unix_time: number;
  block_number?: number;
  volume_usd?: number;
  volume?: number;
  owner?: string;
  source?: string;
  pool_id?: string | null;
  base?: BirdeyeAssetMovement;
  quote?: BirdeyeAssetMovement;
  from?: BirdeyeAssetMovement;
  to?: BirdeyeAssetMovement;
  tokens?: BirdeyeAssetMovement[];
}

export interface BirdeyeBalanceChange {
  tx_hash: string;
  block_unix_time: number;
  block_number?: number | string;
  address?: string;
  token_account?: string;
  pre_balance: number | string;
  post_balance: number | string;
  amount: number | string;
  token_info?: {
    address?: string;
    decimals?: number;
    symbol?: string;
    name?: string;
    is_scaled_ui_token?: boolean;
    multiplier?: number | null;
  };
}

export interface BirdeyeTransfer {
  tx_hash: string;
  unix_time: number;
  token_address: string;
  from_address?: string;
  to_address?: string;
  amount?: number | string;
  ui_amount?: number;
  price?: number;
  value?: number;
  flow?: "in" | "out" | string;
  action?: string;
}

export interface BirdeyeTopTrader {
  owner: string;
  tags?: string[];
  totalPnl?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  trade?: number;
  tradeBuy?: number;
  tradeSell?: number;
  volumeUsd?: number;
  volumeBuyUSD?: number;
  volumeSellUSD?: number;
  volumeBuy?: number;
  volumeSell?: number;
  holdVolume?: number;
  holdVolumeUsd?: number;
  holdAvgPrice?: number;
  avgBuyPrice?: number;
  avgSellPrice?: number;
  firstTradeUnixTime?: number;
  lastTradeUnixTime?: number;
}

export interface BirdeyeCandle {
  unixTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** USD volume, when Birdeye returns it. */
  v_usd?: number;
  type?: string;
}

export interface BirdeyeTokenMetadata {
  address?: string;
  name?: string;
  symbol?: string;
  logo_uri?: string;
  decimals?: number;
}

export interface OffsetPage<T> {
  items: T[];
  hasNext: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}
