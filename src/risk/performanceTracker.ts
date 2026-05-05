import { PaperTrade } from '../core/types';
import { Repositories } from '../storage/repositories';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';
import { EventEmitter } from 'events';

export class PerformanceTracker extends EventEmitter {
  private trades: PaperTrade[] = [];
  private rejectedSignalsCount = 0;
  private snapshotIntervalMs: number;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(snapshotIntervalMs: number = 3600000) { // Default 1 hour
    super();
    this.snapshotIntervalMs = snapshotIntervalMs;
  }

  public start() {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => this.takeSnapshot(), this.snapshotIntervalMs);
    logger.info('PerformanceTracker started');
  }

  public stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    // Take a final snapshot on stop
    this.takeSnapshot();
  }

  public recordTrade(trade: PaperTrade) {
    const existing = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    if (existing >= 0) {
      this.trades[existing] = trade;
    } else {
      this.trades.push(trade);
    }
  }

  public recordRejectedSignal() {
    this.rejectedSignalsCount++;
  }

  public async takeSnapshot() {
    try {
      const openTrades = this.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL_EXIT');
      const closedTrades = this.trades.filter(t => t.status === 'CLOSED');

      const totalTrades = this.trades.length;
      let totalRealizedPnlUsd = 0;
      let wins = 0;
      let losses = 0;
      let sumWinUsd = 0;
      let sumLossUsd = 0;
      let bestTradeUsd = 0;
      let worstTradeUsd = 0;
      let totalDurationMs = 0;

      for (const t of closedTrades) {
        totalRealizedPnlUsd += t.realizedPnlUsd;
        
        if (t.realizedPnlUsd > 0) {
          wins++;
          sumWinUsd += t.realizedPnlUsd;
          if (t.realizedPnlUsd > bestTradeUsd) bestTradeUsd = t.realizedPnlUsd;
        } else if (t.realizedPnlUsd < 0) {
          losses++;
          sumLossUsd += Math.abs(t.realizedPnlUsd);
          if (t.realizedPnlUsd < worstTradeUsd) worstTradeUsd = t.realizedPnlUsd;
        }

        if (t.exitTimestamp && t.entryTimestamp) {
          totalDurationMs += t.exitTimestamp.getTime() - t.entryTimestamp.getTime();
        }
      }

      const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
      const averageWinUsd = wins > 0 ? sumWinUsd / wins : 0;
      const averageLossUsd = losses > 0 ? sumLossUsd / losses : 0;
      const profitFactor = sumLossUsd > 0 ? sumWinUsd / sumLossUsd : (sumWinUsd > 0 ? 999 : 0);
      const averageTradeDurationSeconds = closedTrades.length > 0 ? (totalDurationMs / closedTrades.length) / 1000 : 0;

      // Simplistic max drawdown: worst trade for now
      const maxDrawdownUsd = worstTradeUsd;

      const snapshot = {
        total_trades: totalTrades,
        open_trades: openTrades.length,
        closed_trades: closedTrades.length,
        win_rate: winRate,
        total_realized_pnl_usd: totalRealizedPnlUsd,
        average_win_usd: averageWinUsd,
        average_loss_usd: averageLossUsd,
        profit_factor: profitFactor,
        max_drawdown_usd: maxDrawdownUsd,
        best_trade_usd: bestTradeUsd,
        worst_trade_usd: worstTradeUsd,
        average_trade_duration_seconds: averageTradeDurationSeconds,
        rejected_signals_count: this.rejectedSignalsCount,
        raw_data: { 
           timestamp: new Date().toISOString()
        }
      };

      await Repositories.savePerformanceSnapshot(snapshot);
      
      logger.info('Performance snapshot saved', { totalRealizedPnlUsd, winRate });
      LocalFileLogger.log('INFO', 'PerformanceTracker', 'SNAPSHOT', 'Performance metrics saved', snapshot);

    } catch (err) {
      logger.error('Error taking performance snapshot', { err });
    }
  }
}
