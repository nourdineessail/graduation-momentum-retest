import { strategyConfig } from '../config/strategyConfig';

export class PositionSizing {
  /**
   * Calculate position size in USD based on configured risk per trade.
   * @param totalPortfolioUsd - total paper portfolio size
   */
  static calculatePositionSizeUsd(totalPortfolioUsd: number): number {
    const riskBased = totalPortfolioUsd * (strategyConfig.RISK_PER_TRADE_PERCENT / 100);
    // Cap at the configured flat position size
    return Math.min(riskBased, strategyConfig.POSITION_SIZE_USD);
  }
}
