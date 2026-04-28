import { MarketData } from '../core/types';

export class SignalScorer {
  /**
   * Scores a valid signal from 0 to 100 based on momentum, liquidity, and buy pressure.
   */
  static score(marketData: MarketData): number {
    let score = 50; // Base score for passing filters

    // Add up to 20 points for high liquidity
    const liquidityBonus = Math.min(20, (marketData.liquidityUsd / 100000) * 10);
    score += liquidityBonus;

    // Add up to 15 points for strong buy pressure
    const buyPressureBonus = Math.min(15, (marketData.buySellRatio - 1.0) * 10);
    if (buyPressureBonus > 0) score += buyPressureBonus;

    // Add up to 15 points for unique buyers
    const uniqueBuyersBonus = Math.min(15, marketData.uniqueBuyers);
    score += uniqueBuyersBonus;

    return Math.min(100, Math.round(score));
  }
}
