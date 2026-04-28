import { describe, it, expect, beforeEach } from 'vitest';

// ─── Math Utils ───────────────────────────────────────────────────────────────
import { pullbackPercent, percentChange, clamp, roundTo } from '../src/utils/math';

describe('math utils', () => {
  it('calculates pullback percent correctly', () => {
    expect(pullbackPercent(100, 75)).toBeCloseTo(25);
    expect(pullbackPercent(200, 150)).toBeCloseTo(25);
    expect(pullbackPercent(0, 50)).toBe(0); // edge case: no high
  });

  it('calculates percent change correctly', () => {
    expect(percentChange(100, 180)).toBeCloseTo(80);
    expect(percentChange(0, 50)).toBe(0); // edge case: zero from
  });

  it('clamps values within range', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('rounds to specified decimals', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(0.000001234, 8)).toBe(0.00000123);
  });
});

// ─── PnL Calculator ───────────────────────────────────────────────────────────
import { PnlCalculator } from '../src/paper/pnlCalculator';

describe('PnlCalculator', () => {
  it('calculates unrealized PnL for a winning position', () => {
    const result = PnlCalculator.calculateUnrealized(0.001, 0.002, 1000);
    expect(result.unrealizedPnlUsd).toBeCloseTo(1.0);
    expect(result.unrealizedPnlPercent).toBeCloseTo(100);
  });

  it('calculates unrealized PnL for a losing position', () => {
    const result = PnlCalculator.calculateUnrealized(0.001, 0.0008, 1000);
    expect(result.unrealizedPnlUsd).toBeCloseTo(-0.2);
    expect(result.unrealizedPnlPercent).toBeCloseTo(-20);
  });

  it('returns zero when entryPrice is 0', () => {
    const result = PnlCalculator.calculateUnrealized(0, 0.001, 1000);
    expect(result.unrealizedPnlUsd).toBe(0);
    expect(result.unrealizedPnlPercent).toBe(0);
  });

  it('calculates realized PnL correctly', () => {
    const pnl = PnlCalculator.calculateRealized(0.001, 0.00125, 1000);
    expect(pnl).toBeCloseTo(0.25);
  });

  it('returns negative realized PnL for loss', () => {
    const pnl = PnlCalculator.calculateRealized(0.001, 0.0008, 500);
    expect(pnl).toBeCloseTo(-0.1);
  });
});

// ─── Execution Simulator ──────────────────────────────────────────────────────
import { ExecutionSimulator } from '../src/paper/executionSimulator';

describe('ExecutionSimulator', () => {
  it('successfully simulates a small buy with adequate liquidity', () => {
    const result = ExecutionSimulator.simulateMarketOrder('BUY', 0.001, 50, 100000);
    expect(result.success).toBe(true);
    expect(result.executedPrice).toBeGreaterThan(0.001); // Price goes up due to slippage on buy
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.feesUsd).toBeGreaterThan(0);
  });

  it('rejects a buy if position is too large relative to liquidity', () => {
    // MAX_POSITION_PERCENT_OF_LIQUIDITY = 1%, so 50 is 1% of 5000 — just at limit
    // 50 is more than 1% of 4000 = 40, so should fail
    const result = ExecutionSimulator.simulateMarketOrder('BUY', 0.001, 50, 4000);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('liquidity');
  });

  it('applies sell order without rejecting', () => {
    // Sells should always succeed (forced exit scenario)
    const result = ExecutionSimulator.simulateMarketOrder('SELL', 0.001, 50, 100000);
    expect(result.success).toBe(true);
    expect(result.executedPrice).toBeLessThan(0.001); // Price goes down due to slippage on sell
  });
});

// ─── Risk Manager ─────────────────────────────────────────────────────────────
import { RiskManager } from '../src/risk/riskManager';
import { PaperTrade } from '../src/core/types';

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: 'test-id',
    tradeId: `paper_${Math.random().toString(36).slice(2)}`,
    tokenMint: 'TokenMintXYZ',
    poolAddress: 'PoolABC',
    strategyName: 'GraduationMomentumRetest',
    status: 'OPEN',
    entryTimestamp: new Date(),
    entryPrice: 0.001,
    positionSizeUsd: 50,
    tokenQuantity: 50000,
    realizedPnlUsd: 0,
    realizedPnlPercent: 0,
    unrealizedPnlUsd: 0,
    feesUsd: 0.125,
    slippageUsd: 0.05,
    stopLossPrice: 0.0008,
    takeProfit1Price: 0.00125,
    takeProfit2Price: 0.0015,
    trailingStopPrice: 0.0008,
    ...overrides,
  };
}

describe('RiskManager', () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager();
  });

  const mockSignal = { id: 'sig_001', tokenMint: 'TokenMintXYZ', liquidityUsd: 50000 };

  it('allows trading when conditions are clear', () => {
    const result = riskManager.canTrade(mockSignal);
    expect(result.allowed).toBe(true);
  });

  it('blocks duplicate signals', () => {
    riskManager.canTrade(mockSignal);
    const result = riskManager.canTrade(mockSignal);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Duplicate');
  });

  it('blocks when max open positions is reached', () => {
    for (let i = 0; i < 3; i++) {
      const trade = makeTrade({ tradeId: `paper_${i}` });
      riskManager.onTradeOpened(trade);
    }
    const result = riskManager.canTrade({ id: 'sig_new', tokenMint: 'OtherToken', liquidityUsd: 50000 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Max open positions');
  });

  it('activates cooldown after consecutive losses', () => {
    for (let i = 0; i < 4; i++) {
      const trade = makeTrade({ tradeId: `paper_${i}`, realizedPnlUsd: -10, status: 'CLOSED' });
      riskManager.onTradeOpened(trade);
      riskManager.onTradeClosed(trade);
    }
    const result = riskManager.canTrade({ id: 'sig_after', tokenMint: 'AnotherToken', liquidityUsd: 50000 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cooldown');
  });

  it('detects stale data correctly', () => {
    const oldTimestamp = Date.now() - 25000; // 25 seconds ago
    expect(riskManager.isDataStale(oldTimestamp)).toBe(true);
    expect(riskManager.isDataStale(Date.now())).toBe(false);
  });
});

// ─── Filters ──────────────────────────────────────────────────────────────────
import { LiquidityFilter } from '../src/filters/liquidityFilter';
import { MomentumFilter } from '../src/filters/momentumFilter';
import { MarketData } from '../src/core/types';

function makeMarketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    price: 0.001,
    liquidityUsd: 25000,
    localHigh: 0.0018,
    localLow: 0.0005,
    pullbackPercent: 33,
    vwap: 0.0009,
    buySellRatio: 1.8,
    uniqueBuyers: 12,
    uniqueSellers: 5,
    ...overrides,
  };
}

describe('LiquidityFilter', () => {
  it('passes when liquidity is above minimum', () => {
    const result = LiquidityFilter.pass(makeMarketData({ liquidityUsd: 50000 }));
    expect(result.passed).toBe(true);
  });

  it('rejects when liquidity is below minimum', () => {
    const result = LiquidityFilter.pass(makeMarketData({ liquidityUsd: 500 }));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('too low');
  });
});

describe('MomentumFilter', () => {
  it('detects valid impulse from initial price', () => {
    const data = makeMarketData({ localHigh: 0.00182 });
    expect(MomentumFilter.checkImpulse(data, 0.001)).toBe(true); // 82% impulse
  });

  it('rejects insufficient impulse', () => {
    const data = makeMarketData({ localHigh: 0.0011 });
    expect(MomentumFilter.checkImpulse(data, 0.001)).toBe(false); // Only 10% impulse
  });

  it('validates pullback within range', () => {
    expect(MomentumFilter.checkPullback(makeMarketData({ pullbackPercent: 30 }))).toBe(true);
    expect(MomentumFilter.checkPullback(makeMarketData({ pullbackPercent: 10 }))).toBe(false); // Too shallow
    expect(MomentumFilter.checkPullback(makeMarketData({ pullbackPercent: 55 }))).toBe(false); // Too deep
  });

  it('confirms VWAP reclaim when price is above VWAP', () => {
    const data = makeMarketData({ price: 0.00095, vwap: 0.0009 }); // 5.5% above VWAP, within max
    expect(MomentumFilter.checkReclaim(data)).toBe(true);
  });

  it('rejects VWAP reclaim when price is below VWAP', () => {
    const data = makeMarketData({ price: 0.0007, vwap: 0.0009 });
    expect(MomentumFilter.checkReclaim(data)).toBe(false);
  });

  it('rejects reclaim if price is too far above VWAP', () => {
    // MAX_PRICE_ABOVE_RECLAIM_PERCENT=8, so price must be <= vwap*1.08
    const data = makeMarketData({ price: 0.0012, vwap: 0.0009 }); // 33% above
    expect(MomentumFilter.checkReclaim(data)).toBe(false);
  });

  it('validates buy pressure', () => {
    expect(MomentumFilter.checkBuyPressure(makeMarketData({ buySellRatio: 1.8, uniqueBuyers: 10 }))).toBe(true);
    expect(MomentumFilter.checkBuyPressure(makeMarketData({ buySellRatio: 1.0, uniqueBuyers: 10 }))).toBe(false);
    expect(MomentumFilter.checkBuyPressure(makeMarketData({ buySellRatio: 1.8, uniqueBuyers: 2 }))).toBe(false);
  });
});
