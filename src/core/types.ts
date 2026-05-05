export type StrategyState =
  | 'DETECTED'
  | 'FILTERING'
  | 'WATCHING_IMPULSE'
  | 'WAITING_PULLBACK'
  | 'WAITING_RECLAIM'
  | 'ENTERED'
  | 'EXITING'
  | 'CLOSED'
  | 'REJECTED'
  | 'ERROR';

export interface PoolInfo {
  poolAddress: string;
  tokenMint: string;
  quoteMint: string; // Should be SOL or USDC
  baseVault: string;
  quoteVault: string;
  createdAt: Date;
}

export interface MarketData {
  timestamp: number;
  dataQuality: 'REAL' | 'PARTIAL' | 'MOCKED' | 'UNKNOWN';
  price: number;
  liquidityUsd: number;
  localHigh: number;
  localLow: number;
  pullbackPercent: number;
  vwap: number;
  quoteVaultDeltaUsd: number;
  netBuyPressure: number;
  flowDirection: 'BUY' | 'SELL' | 'NEUTRAL';
  uniqueBuyers: number | null;
  uniqueSellers: number | null;
}

export interface Signal {
  id: string;
  tokenMint: string;
  poolAddress: string;
  signalType: 'ENTRY' | 'EXIT';
  strength?: number;
  price: number;
  liquidityUsd: number;
  localHigh: number;
  pullbackPercent: number;
  vwap: number;
  netBuyPressure: number;
  uniqueBuyers: number | null;
  passed: boolean;
  rejectionReason?: string;
  timestamp: Date;
}

export type TradeStatus = 'OPEN' | 'PARTIAL_EXIT' | 'CLOSED' | 'REJECTED';

export interface PaperTrade {
  id: string;
  tradeId: string;
  tokenMint: string;
  poolAddress: string;
  strategyName: string;
  status: TradeStatus;
  entryTimestamp: Date;
  exitTimestamp?: Date;
  entryPrice: number;
  averageExitPrice?: number;
  positionSizeUsd: number;
  tokenQuantity: number;
  originalTokenQuantity: number;
  realizedPnlUsd: number;
  realizedPnlPercent: number;
  unrealizedPnlUsd: number;
  feesUsd: number;
  slippageUsd: number;
  stopLossPrice: number;
  takeProfit1Price: number;
  takeProfit2Price: number;
  trailingStopPrice: number;
  exitReason?: string;
}
