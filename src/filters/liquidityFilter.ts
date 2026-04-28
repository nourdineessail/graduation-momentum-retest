import { MarketData } from '../core/types';
import { strategyConfig } from '../config/strategyConfig';
import { env } from '../config/env';

export class LiquidityFilter {
  static pass(marketData: MarketData): { passed: boolean; reason?: string } {
    const minLiquidity = env.MIN_LIQUIDITY_USD || strategyConfig.MIN_LIQUIDITY_USD;
    const maxLiquidity = strategyConfig.MAX_LIQUIDITY_USD;

    if (marketData.liquidityUsd < minLiquidity) {
      return { passed: false, reason: `Liquidity too low: $${marketData.liquidityUsd.toFixed(2)} < $${minLiquidity}` };
    }

    if (maxLiquidity > 0 && marketData.liquidityUsd > maxLiquidity) {
      return { passed: false, reason: `Liquidity too high: $${marketData.liquidityUsd.toFixed(2)} > $${maxLiquidity}` };
    }

    return { passed: true };
  }
}
