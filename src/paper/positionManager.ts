import { PaperTrade } from '../core/types';
import { strategyConfig } from '../config/strategyConfig';
import { PnlCalculator } from './pnlCalculator';
import { Repositories } from '../storage/repositories';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';
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

  public updatePosition(tradeId: string, currentPrice: number) {
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

    this.checkExitConditions(trade, currentPrice);
    Repositories.savePaperTrade(trade);
  }

  private checkExitConditions(trade: PaperTrade, currentPrice: number) {
    // Stop Loss
    if (currentPrice <= trade.stopLossPrice) {
      this.triggerFullExit(trade, currentPrice, 'STOP_LOSS');
      return;
    }

    // Trailing Stop (only after TP1 hit, so partial position)
    if (trade.status === 'PARTIAL_EXIT' && currentPrice <= trade.trailingStopPrice) {
      this.triggerFullExit(trade, currentPrice, 'TRAILING_STOP');
      return;
    }

    // Take Profit 1
    if (trade.status === 'OPEN' && currentPrice >= trade.takeProfit1Price) {
      this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_1', strategyConfig.TAKE_PROFIT_1_SIZE_PERCENT);
      return;
    }

    // Take Profit 2
    if (trade.status === 'PARTIAL_EXIT' && currentPrice >= trade.takeProfit2Price) {
      this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_2', strategyConfig.TAKE_PROFIT_2_SIZE_PERCENT);
      return;
    }

    // Time Stop
    const durationMs = Date.now() - trade.entryTimestamp.getTime();
    const durationMinutes = durationMs / 60000;
    if (durationMinutes >= strategyConfig.TIME_STOP_MINUTES) {
      this.triggerFullExit(trade, currentPrice, 'TIME_STOP');
    }
  }

  private triggerPartialExit(trade: PaperTrade, price: number, reason: string, sizePercent: number) {
    const quantitySold = trade.tokenQuantity * (sizePercent / 100);
    const realizedPnl = PnlCalculator.calculateRealized(trade.entryPrice, price, quantitySold);

    trade.realizedPnlUsd += realizedPnl;
    trade.tokenQuantity -= quantitySold;
    trade.status = 'PARTIAL_EXIT';
    trade.exitReason = reason;
    trade.averageExitPrice = price;

    logger.info(`Partial exit [${reason}] for ${trade.tradeId} at $${price.toFixed(8)}`, {
      quantitySold,
      realizedPnl,
    });

    LocalFileLogger.log('INFO', 'PositionManager', reason, `Partial exit executed`, { price, quantitySold, realizedPnl }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });

    this.emit('partialExit', { trade, exitPrice: price, quantitySold, exitReason: reason, partial: true } as ExitEvent);
    Repositories.savePaperTrade(trade);

    Repositories.saveError('PositionManager', 'TRADE_EXIT', `partial exit ${reason}`, { tradeId: trade.tradeId, reason, price });
  }

  private triggerFullExit(trade: PaperTrade, price: number, reason: string) {
    const realizedPnl = PnlCalculator.calculateRealized(trade.entryPrice, price, trade.tokenQuantity);
    const entryValue = trade.entryPrice * (trade.positionSizeUsd / trade.entryPrice);

    trade.realizedPnlUsd += realizedPnl;
    trade.realizedPnlPercent = (trade.realizedPnlUsd / trade.positionSizeUsd) * 100;
    trade.unrealizedPnlUsd = 0;
    trade.status = 'CLOSED';
    trade.exitTimestamp = new Date();
    trade.exitReason = reason;
    trade.averageExitPrice = price;

    this.openPositions.delete(trade.tradeId);

    logger.info(`Full exit [${reason}] for ${trade.tradeId} at $${price.toFixed(8)} | PnL: $${trade.realizedPnlUsd.toFixed(2)}`, {
      tradeId: trade.tradeId,
    });

    LocalFileLogger.log(
      trade.realizedPnlUsd >= 0 ? 'INFO' : 'WARN',
      'PositionManager',
      reason,
      `Full exit executed`,
      { price, pnl: trade.realizedPnlUsd },
      { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId }
    );

    this.emit('fullExit', { trade, exitPrice: price, quantitySold: trade.tokenQuantity, exitReason: reason, partial: false } as ExitEvent);
    Repositories.savePaperTrade(trade);
  }

  public forceExit(tradeId: string, currentPrice: number, reason: string) {
    const trade = this.openPositions.get(tradeId);
    if (!trade) return;
    this.triggerFullExit(trade, currentPrice, reason);
  }
}
