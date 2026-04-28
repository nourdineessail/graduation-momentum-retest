import { DEX_FEE_PERCENT } from '../core/constants';
import { strategyConfig } from '../config/strategyConfig';

export interface SimulatedExecutionResult {
  success: boolean;
  executedPrice: number;
  quantity: number;
  feesUsd: number;
  slippageUsd: number;
  reason?: string;
}

export class ExecutionSimulator {
  /**
   * Simulates a market buy or sell order.
   * Assumes some average slippage based on config, and applies DEX fees.
   */
  static simulateMarketOrder(
    side: 'BUY' | 'SELL',
    intendedPrice: number,
    amountUsd: number,
    poolLiquidityUsd: number
  ): SimulatedExecutionResult {
    // 1. Check max position relative to liquidity
    const maxAllowedUsd = poolLiquidityUsd * (strategyConfig.MAX_POSITION_PERCENT_OF_LIQUIDITY / 100);
    if (side === 'BUY' && amountUsd > maxAllowedUsd) {
      return { success: false, executedPrice: 0, quantity: 0, feesUsd: 0, slippageUsd: 0, reason: 'Size exceeds max liquidity percentage' };
    }

    // 2. Simulate Slippage
    // More size relative to liquidity = more slippage
    // Base random slippage between 0.1% and 1% + size impact
    const baseSlippage = (Math.random() * 0.9 + 0.1);
    const impactSlippage = (amountUsd / Math.max(1, poolLiquidityUsd)) * 100;
    
    let slippagePercent = baseSlippage + impactSlippage;
    
    // Cap at max configured slippage or fail
    if (slippagePercent > strategyConfig.MAX_SLIPPAGE_PERCENT) {
      if (side === 'BUY') {
         return { success: false, executedPrice: 0, quantity: 0, feesUsd: 0, slippageUsd: 0, reason: `Slippage too high: ${slippagePercent.toFixed(2)}%` };
      } else {
         // Force exit, but apply max slippage penalty
         slippagePercent = strategyConfig.MAX_SLIPPAGE_PERCENT * 1.5; // Penalty for forced exit
      }
    }

    // 3. Calculate execution price
    const slippageMultiplier = side === 'BUY' ? (1 + slippagePercent / 100) : (1 - slippagePercent / 100);
    const executedPrice = intendedPrice * slippageMultiplier;

    // 4. Calculate fees
    const feesUsd = amountUsd * (DEX_FEE_PERCENT / 100);

    // 5. Calculate final token quantity
    const netAmountUsd = side === 'BUY' ? amountUsd - feesUsd : amountUsd;
    const quantity = netAmountUsd / executedPrice;

    const slippageUsd = Math.abs((intendedPrice - executedPrice) * quantity);

    return {
      success: true,
      executedPrice,
      quantity,
      feesUsd,
      slippageUsd
    };
  }
}
