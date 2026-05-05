"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceTracker = void 0;
const repositories_1 = require("../storage/repositories");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
const events_1 = require("events");
class PerformanceTracker extends events_1.EventEmitter {
    trades = [];
    rejectedSignalsCount = 0;
    snapshotIntervalMs;
    intervalTimer = null;
    constructor(snapshotIntervalMs = 3600000) {
        super();
        this.snapshotIntervalMs = snapshotIntervalMs;
    }
    start() {
        if (this.intervalTimer)
            return;
        this.intervalTimer = setInterval(() => this.takeSnapshot(), this.snapshotIntervalMs);
        logger_1.logger.info('PerformanceTracker started');
    }
    stop() {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
        // Take a final snapshot on stop
        this.takeSnapshot();
    }
    recordTrade(trade) {
        const existing = this.trades.findIndex(t => t.tradeId === trade.tradeId);
        if (existing >= 0) {
            this.trades[existing] = trade;
        }
        else {
            this.trades.push(trade);
        }
    }
    recordRejectedSignal() {
        this.rejectedSignalsCount++;
    }
    async takeSnapshot() {
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
                    if (t.realizedPnlUsd > bestTradeUsd)
                        bestTradeUsd = t.realizedPnlUsd;
                }
                else if (t.realizedPnlUsd < 0) {
                    losses++;
                    sumLossUsd += Math.abs(t.realizedPnlUsd);
                    if (t.realizedPnlUsd < worstTradeUsd)
                        worstTradeUsd = t.realizedPnlUsd;
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
            await repositories_1.Repositories.savePerformanceSnapshot(snapshot);
            logger_1.logger.info('Performance snapshot saved', { totalRealizedPnlUsd, winRate });
            localFileLogger_1.LocalFileLogger.log('INFO', 'PerformanceTracker', 'SNAPSHOT', 'Performance metrics saved', snapshot);
        }
        catch (err) {
            logger_1.logger.error('Error taking performance snapshot', { err });
        }
    }
}
exports.PerformanceTracker = PerformanceTracker;
