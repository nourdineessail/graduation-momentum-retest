import { MarketData } from '../core/types';
import { strategyConfig } from '../config/strategyConfig';

export class MomentumFilter {
  static checkImpulse(marketData: MarketData, initialPrice: number): boolean {
    if (initialPrice === 0) return false;
    const impulsePercent = ((marketData.localHigh - initialPrice) / initialPrice) * 100;
    return impulsePercent >= strategyConfig.MIN_IMPULSE_PERCENT;
  }

  static checkPullback(marketData: MarketData): boolean {
    return (
      marketData.pullbackPercent >= strategyConfig.PULLBACK_MIN_PERCENT &&
      marketData.pullbackPercent <= strategyConfig.PULLBACK_MAX_PERCENT
    );
  }

  static checkReclaim(marketData: MarketData): boolean {
    if (!strategyConfig.VWAP_RECLAIM_REQUIRED) return true;
    
    // Price must have dipped below VWAP (during pullback) and now be back above it.
    // For this engine, we assume the state machine only enters WAITING_RECLAIM if it pulled back enough.
    // So we just check if current price > VWAP and within acceptable max range.
    const maxAllowedPrice = marketData.vwap * (1 + (strategyConfig.MAX_PRICE_ABOVE_RECLAIM_PERCENT / 100));
    
    return marketData.price >= marketData.vwap && marketData.price <= maxAllowedPrice;
  }

  static checkBuyPressure(marketData: MarketData): boolean {
    const buyPressurePasses = marketData.netBuyPressure >= strategyConfig.MIN_BUY_SELL_RATIO;
    
    if (marketData.dataQuality === 'PARTIAL' || marketData.dataQuality === 'MOCKED') {
      // Bypass unique buyers check if we don't have perfect wallet tracking
      // Instead, we require slightly stronger net flow confirmation (e.g. 1.1x the config)
      return marketData.netBuyPressure >= (strategyConfig.MIN_BUY_SELL_RATIO * 1.1);
    }

    return (
      buyPressurePasses &&
      (marketData.uniqueBuyers ?? 0) >= strategyConfig.MIN_UNIQUE_BUYERS
    );
  }
}
