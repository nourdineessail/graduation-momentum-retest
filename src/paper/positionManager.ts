import { PaperTrade } from '../core/types';
import { strategyConfig } from '../config/strategyConfig';
import { PnlCalculator } from './pnlCalculator';
import { Repositories } from '../storage/repositories';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';
import { ExecutionSimulator } from './executionSimulator';
import { EventEmitter } from 'events';

export interface ExitEvent {
  trade: PaperTrade;
  exitPrice: number;
  quantitySold: number;
  exitReason: string;
  partial: boolean;
}

export class PositionManager extends EventEmitter {
  private openPositions: Map<string, PaperTrade> = new Map();

  public addPosition(trade: PaperTrade) {
    this.openPositions.set(trade.tradeId, trade);
    logger.info(`Position opened: ${trade.tradeId}`, { tokenMint: trade.tokenMint });
  }

  public getOpenPositions(): PaperTrade[] {
    return Array.from(this.openPositions.values());
  }

  public getPosition(tradeId: string): PaperTrade | undefined {
    return this.openPositions.get(tradeId);
  }

  public updatePosition(tradeId: string, currentPrice: number, liquidityUsd: number) {
    const trade = this.openPositions.get(tradeId);
    if (!trade) return;

    const { unrealizedPnlUsd } = PnlCalculator.calculateUnrealized(
      trade.entryPrice,
      currentPrice,
      trade.tokenQuantity
    );
    trade.unrealizedPnlUsd = unrealizedPnlUsd;

    // Update trailing stop
    const newTrailingStop = currentPrice * (1 - strategyConfig.TRAILING_STOP_PERCENT / 100);
    if (newTrailingStop > trade.trailingStopPrice) {
      trade.trailingStopPrice = newTrailingStop;
    }

    this.checkExitConditions(trade, currentPrice, liquidityUsd);
    Repositories.savePaperTrade(trade);
  }

  private checkExitConditions(trade: PaperTrade, currentPrice: number, liquidityUsd: number) {
    // Stop Loss
    if (currentPrice <= trade.stopLossPrice) {
      this.triggerFullExit(trade, currentPrice, 'STOP_LOSS', liquidityUsd);
      return;
    }

    // Trailing Stop (only after TP1 hit, so partial position)
    if (trade.status === 'PARTIAL_EXIT' && currentPrice <= trade.trailingStopPrice) {
      this.triggerFullExit(trade, currentPrice, 'TRAILING_STOP', liquidityUsd);
      return;
    }

    // Take Profit 1
    if (trade.status === 'OPEN' && currentPrice >= trade.takeProfit1Price) {
      this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_1', strategyConfig.TAKE_PROFIT_1_SIZE_PERCENT, liquidityUsd);
      return;
    }

    // Take Profit 2
    if (trade.status === 'PARTIAL_EXIT' && currentPrice >= trade.takeProfit2Price) {
      this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_2', strategyConfig.TAKE_PROFIT_2_SIZE_PERCENT, liquidityUsd);
      return;
    }

    // Time Stop
    const durationMs = Date.now() - trade.entryTimestamp.getTime();
    const durationMinutes = durationMs / 60000;
    if (durationMinutes >= strategyConfig.TIME_STOP_MINUTES) {
      this.triggerFullExit(trade, currentPrice, 'TIME_STOP', liquidityUsd);
    }
  }

  private triggerPartialExit(trade: PaperTrade, price: number, reason: string, sizePercent: number, liquidityUsd: number) {
    const quantityToSell = trade.originalTokenQuantity * (sizePercent / 100);
    // Ensure we don't sell more than we have (just in case of weird math)
    const quantitySold = Math.min(quantityToSell, trade.tokenQuantity);

    const positionValueUsd = quantitySold * price;
    const sim = ExecutionSimulator.simulateMarketOrder('SELL', price, positionValueUsd, liquidityUsd);

    if (!sim.success) {
      logger.warn(`Partial exit failed simulation: ${sim.reason}`);
      return;
    }

    const executedPrice = sim.executedPrice;
    trade.feesUsd += sim.feesUsd;
    trade.slippageUsd += sim.slippageUsd;

    const realizedPnl = PnlCalculator.calculateRealized(trade.entryPrice, executedPrice, quantitySold);

    trade.realizedPnlUsd += realizedPnl;
    trade.tokenQuantity -= quantitySold;
    trade.status = 'PARTIAL_EXIT';
    trade.exitReason = reason;
    trade.averageExitPrice = executedPrice;

    logger.info(`Partial exit [${reason}] for ${trade.tradeId} at $${executedPrice.toFixed(8)}`, {
      quantitySold,
      realizedPnl,
      fees: sim.feesUsd,
      slippage: sim.slippageUsd,
    });

    LocalFileLogger.log('INFO', 'PositionManager', reason, `Partial exit executed`, { executedPrice, quantitySold, realizedPnl }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });

    this.emit('partialExit', { trade, exitPrice: executedPrice, quantitySold, exitReason: reason, partial: true } as ExitEvent);
    Repositories.savePaperTrade(trade);

    Repositories.savePaperTradeExit(trade.tradeId, executedPrice, quantitySold, realizedPnl, reason, sim.feesUsd, sim.slippageUsd);
  }

  private triggerFullExit(trade: PaperTrade, price: number, reason: string, liquidityUsd: number) {
    const quantitySold = trade.tokenQuantity;
    const positionValueUsd = quantitySold * price;
    const sim = ExecutionSimulator.simulateMarketOrder('SELL', price, positionValueUsd, liquidityUsd);

    let executedPrice = price;
    let exitFees = 0;
    let exitSlippage = 0;

    if (sim.success) {
      executedPrice = sim.executedPrice;
      exitFees = sim.feesUsd;
      exitSlippage = sim.slippageUsd;
      trade.feesUsd += sim.feesUsd;
      trade.slippageUsd += sim.slippageUsd;
    } else {
      logger.warn(`Full exit failed simulation (using rough price): ${sim.reason}`);
    }

    const realizedPnl = PnlCalculator.calculateRealized(trade.entryPrice, executedPrice, quantitySold);

    trade.realizedPnlUsd += realizedPnl;
    trade.realizedPnlPercent = (trade.realizedPnlUsd / trade.positionSizeUsd) * 100;
    trade.unrealizedPnlUsd = 0;
    trade.status = 'CLOSED';
    trade.exitTimestamp = new Date();
    trade.exitReason = reason;
    trade.averageExitPrice = executedPrice;

    this.openPositions.delete(trade.tradeId);

    logger.info(`Full exit [${reason}] for ${trade.tradeId} at $${executedPrice.toFixed(8)} | PnL: $${trade.realizedPnlUsd.toFixed(2)}`, {
      tradeId: trade.tradeId,
    });

    LocalFileLogger.log(
      trade.realizedPnlUsd >= 0 ? 'INFO' : 'WARN',
      'PositionManager',
      reason,
      `Full exit executed`,
      { executedPrice, pnl: trade.realizedPnlUsd },
      { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId }
    );

    this.emit('fullExit', { trade, exitPrice: executedPrice, quantitySold, exitReason: reason, partial: false } as ExitEvent);
    Repositories.savePaperTrade(trade);
    Repositories.savePaperTradeExit(trade.tradeId, executedPrice, quantitySold, realizedPnl, reason, exitFees, exitSlippage);
  }

  public forceExit(tradeId: string, currentPrice: number, reason: string, liquidityUsd: number = 0) {
    const trade = this.openPositions.get(tradeId);
    if (!trade) return;
    this.triggerFullExit(trade, currentPrice, reason, liquidityUsd);
  }
}
