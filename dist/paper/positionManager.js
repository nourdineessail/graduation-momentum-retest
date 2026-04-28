"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositionManager = void 0;
const strategyConfig_1 = require("../config/strategyConfig");
const pnlCalculator_1 = require("./pnlCalculator");
const repositories_1 = require("../storage/repositories");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
const events_1 = require("events");
class PositionManager extends events_1.EventEmitter {
    openPositions = new Map();
    addPosition(trade) {
        this.openPositions.set(trade.tradeId, trade);
        logger_1.logger.info(`Position opened: ${trade.tradeId}`, { tokenMint: trade.tokenMint });
    }
    getOpenPositions() {
        return Array.from(this.openPositions.values());
    }
    getPosition(tradeId) {
        return this.openPositions.get(tradeId);
    }
    updatePosition(tradeId, currentPrice) {
        const trade = this.openPositions.get(tradeId);
        if (!trade)
            return;
        const { unrealizedPnlUsd } = pnlCalculator_1.PnlCalculator.calculateUnrealized(trade.entryPrice, currentPrice, trade.tokenQuantity);
        trade.unrealizedPnlUsd = unrealizedPnlUsd;
        // Update trailing stop
        const newTrailingStop = currentPrice * (1 - strategyConfig_1.strategyConfig.TRAILING_STOP_PERCENT / 100);
        if (newTrailingStop > trade.trailingStopPrice) {
            trade.trailingStopPrice = newTrailingStop;
        }
        this.checkExitConditions(trade, currentPrice);
        repositories_1.Repositories.savePaperTrade(trade);
    }
    checkExitConditions(trade, currentPrice) {
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
            this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_1', strategyConfig_1.strategyConfig.TAKE_PROFIT_1_SIZE_PERCENT);
            return;
        }
        // Take Profit 2
        if (trade.status === 'PARTIAL_EXIT' && currentPrice >= trade.takeProfit2Price) {
            this.triggerPartialExit(trade, currentPrice, 'TAKE_PROFIT_2', strategyConfig_1.strategyConfig.TAKE_PROFIT_2_SIZE_PERCENT);
            return;
        }
        // Time Stop
        const durationMs = Date.now() - trade.entryTimestamp.getTime();
        const durationMinutes = durationMs / 60000;
        if (durationMinutes >= strategyConfig_1.strategyConfig.TIME_STOP_MINUTES) {
            this.triggerFullExit(trade, currentPrice, 'TIME_STOP');
        }
    }
    triggerPartialExit(trade, price, reason, sizePercent) {
        const quantitySold = trade.tokenQuantity * (sizePercent / 100);
        const realizedPnl = pnlCalculator_1.PnlCalculator.calculateRealized(trade.entryPrice, price, quantitySold);
        trade.realizedPnlUsd += realizedPnl;
        trade.tokenQuantity -= quantitySold;
        trade.status = 'PARTIAL_EXIT';
        trade.exitReason = reason;
        trade.averageExitPrice = price;
        logger_1.logger.info(`Partial exit [${reason}] for ${trade.tradeId} at $${price.toFixed(8)}`, {
            quantitySold,
            realizedPnl,
        });
        localFileLogger_1.LocalFileLogger.log('INFO', 'PositionManager', reason, `Partial exit executed`, { price, quantitySold, realizedPnl }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });
        this.emit('partialExit', { trade, exitPrice: price, quantitySold, exitReason: reason, partial: true });
        repositories_1.Repositories.savePaperTrade(trade);
        repositories_1.Repositories.saveError('PositionManager', 'TRADE_EXIT', `partial exit ${reason}`, { tradeId: trade.tradeId, reason, price });
    }
    triggerFullExit(trade, price, reason) {
        const realizedPnl = pnlCalculator_1.PnlCalculator.calculateRealized(trade.entryPrice, price, trade.tokenQuantity);
        const entryValue = trade.entryPrice * (trade.positionSizeUsd / trade.entryPrice);
        trade.realizedPnlUsd += realizedPnl;
        trade.realizedPnlPercent = (trade.realizedPnlUsd / trade.positionSizeUsd) * 100;
        trade.unrealizedPnlUsd = 0;
        trade.status = 'CLOSED';
        trade.exitTimestamp = new Date();
        trade.exitReason = reason;
        trade.averageExitPrice = price;
        this.openPositions.delete(trade.tradeId);
        logger_1.logger.info(`Full exit [${reason}] for ${trade.tradeId} at $${price.toFixed(8)} | PnL: $${trade.realizedPnlUsd.toFixed(2)}`, {
            tradeId: trade.tradeId,
        });
        localFileLogger_1.LocalFileLogger.log(trade.realizedPnlUsd >= 0 ? 'INFO' : 'WARN', 'PositionManager', reason, `Full exit executed`, { price, pnl: trade.realizedPnlUsd }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });
        this.emit('fullExit', { trade, exitPrice: price, quantitySold: trade.tokenQuantity, exitReason: reason, partial: false });
        repositories_1.Repositories.savePaperTrade(trade);
    }
    forceExit(tradeId, currentPrice, reason) {
        const trade = this.openPositions.get(tradeId);
        if (!trade)
            return;
        this.triggerFullExit(trade, currentPrice, reason);
    }
}
exports.PositionManager = PositionManager;
