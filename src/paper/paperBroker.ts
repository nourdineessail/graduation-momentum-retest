import { Signal, PaperTrade } from '../core/types';
import { strategyConfig } from '../config/strategyConfig';
import { ExecutionSimulator } from './executionSimulator';
import { PositionManager } from './positionManager';
import { Repositories } from '../storage/repositories';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';
import { generateId } from '../utils/ids';
import { env } from '../config/env';

export class PaperBroker {
  constructor(private positionManager: PositionManager) {}

  public async executeEntry(signal: Signal): Promise<PaperTrade | null> {
    const positionSizeUsd = env.POSITION_SIZE_USD || strategyConfig.POSITION_SIZE_USD;

    // Simulate market buy
    const sim = ExecutionSimulator.simulateMarketOrder(
      'BUY',
      signal.price,
      positionSizeUsd,
      signal.liquidityUsd
    );

    if (!sim.success) {
      logger.warn(`Entry rejected by execution simulator: ${sim.reason}`, { signalId: signal.id });
      LocalFileLogger.log('WARN', 'PaperBroker', 'ENTRY_REJECTED', sim.reason || 'Execution failed', { signalId: signal.id }, { token: signal.tokenMint, pool: signal.poolAddress });
      return null;
    }

    const tradeId = `paper_${generateId()}`;
    const entryPrice = sim.executedPrice;

    const stopLossPrice = entryPrice * (1 - (env.STOP_LOSS_PERCENT || strategyConfig.STOP_LOSS_PERCENT) / 100);
    const takeProfit1Price = entryPrice * (1 + (env.TAKE_PROFIT_1_PERCENT || strategyConfig.TAKE_PROFIT_1_PERCENT) / 100);
    const takeProfit2Price = entryPrice * (1 + (env.TAKE_PROFIT_2_PERCENT || strategyConfig.TAKE_PROFIT_2_PERCENT) / 100);
    const trailingStopPrice = entryPrice * (1 - strategyConfig.TRAILING_STOP_PERCENT / 100);

    const trade: PaperTrade = {
      id: generateId(24),
      tradeId,
      tokenMint: signal.tokenMint,
      poolAddress: signal.poolAddress,
      strategyName: 'GraduationMomentumRetest',
      status: 'OPEN',
      entryTimestamp: new Date(),
      entryPrice,
      positionSizeUsd,
      tokenQuantity: sim.quantity,
      realizedPnlUsd: 0,
      realizedPnlPercent: 0,
      unrealizedPnlUsd: 0,
      feesUsd: sim.feesUsd,
      slippageUsd: sim.slippageUsd,
      stopLossPrice,
      takeProfit1Price,
      takeProfit2Price,
      trailingStopPrice,
    };

    this.positionManager.addPosition(trade);
    await Repositories.savePaperTrade(trade);

    logger.info(`Paper BUY executed: ${tradeId}`, {
      tokenMint: signal.tokenMint,
      entryPrice,
      quantity: sim.quantity,
      fees: sim.feesUsd,
      slippage: sim.slippageUsd,
    });

    LocalFileLogger.log(
      'INFO', 'PaperBroker', 'PAPER_BUY',
      `Paper trade opened at $${entryPrice.toFixed(8)}`,
      { entryPrice, quantity: sim.quantity, fees: sim.feesUsd, slippage: sim.slippageUsd, stopLossPrice, takeProfit1Price, takeProfit2Price },
      { token: signal.tokenMint, pool: signal.poolAddress, tradeId }
    );

    await Repositories.logEvent('INFO', 'PAPER_BUY', `Paper trade opened`, {
      tradeId,
      tokenMint: signal.tokenMint,
      poolAddress: signal.poolAddress,
      entryPrice,
    });

    return trade;
  }
}
