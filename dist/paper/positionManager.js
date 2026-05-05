"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositionManager = void 0;
const strategyConfig_1 = require("../config/strategyConfig");
const pnlCalculator_1 = require("./pnlCalculator");
const repositories_1 = require("../storage/repositories");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
const executionSimulator_1 = require("./executionSimulator");
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
        const quantityToSell = trade.originalTokenQuantity * (sizePercent / 100);
        // Ensure we don't sell more than we have (just in case of weird math)
        const quantitySold = Math.min(quantityToSell, trade.tokenQuantity);
        const positionValueUsd = quantitySold * price;
        const sim = executionSimulator_1.ExecutionSimulator.simulateMarketOrder('SELL', price, positionValueUsd, positionValueUsd * 10); // Mock large liquidity for exits
        if (!sim.success) {
            logger_1.logger.warn(`Partial exit failed simulation: ${sim.reason}`);
            return;
        }
        const executedPrice = sim.executedPrice;
        trade.feesUsd += sim.feesUsd;
        trade.slippageUsd += sim.slippageUsd;
        const realizedPnl = pnlCalculator_1.PnlCalculator.calculateRealized(trade.entryPrice, executedPrice, quantitySold);
        trade.realizedPnlUsd += realizedPnl;
        trade.tokenQuantity -= quantitySold;
        trade.status = 'PARTIAL_EXIT';
        trade.exitReason = reason;
        trade.averageExitPrice = executedPrice;
        logger_1.logger.info(`Partial exit [${reason}] for ${trade.tradeId} at $${executedPrice.toFixed(8)}`, {
            quantitySold,
            realizedPnl,
            fees: sim.feesUsd,
            slippage: sim.slippageUsd,
        });
        localFileLogger_1.LocalFileLogger.log('INFO', 'PositionManager', reason, `Partial exit executed`, { executedPrice, quantitySold, realizedPnl }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });
        this.emit('partialExit', { trade, exitPrice: executedPrice, quantitySold, exitReason: reason, partial: true });
        repositories_1.Repositories.savePaperTrade(trade);
        repositories_1.Repositories.savePaperTradeExit(trade.tradeId, executedPrice, quantitySold, realizedPnl, reason, sim.feesUsd, sim.slippageUsd);
    }
    triggerFullExit(trade, price, reason) {
        const quantitySold = trade.tokenQuantity;
        const positionValueUsd = quantitySold * price;
        const sim = executionSimulator_1.ExecutionSimulator.simulateMarketOrder('SELL', price, positionValueUsd, positionValueUsd * 10);
        let executedPrice = price;
        let exitFees = 0;
        let exitSlippage = 0;
        if (sim.success) {
            executedPrice = sim.executedPrice;
            exitFees = sim.feesUsd;
            exitSlippage = sim.slippageUsd;
            trade.feesUsd += sim.feesUsd;
            trade.slippageUsd += sim.slippageUsd;
        }
        else {
            logger_1.logger.warn(`Full exit failed simulation (using rough price): ${sim.reason}`);
        }
        const realizedPnl = pnlCalculator_1.PnlCalculator.calculateRealized(trade.entryPrice, executedPrice, quantitySold);
        trade.realizedPnlUsd += realizedPnl;
        trade.realizedPnlPercent = (trade.realizedPnlUsd / trade.positionSizeUsd) * 100;
        trade.unrealizedPnlUsd = 0;
        trade.status = 'CLOSED';
        trade.exitTimestamp = new Date();
        trade.exitReason = reason;
        trade.averageExitPrice = executedPrice;
        this.openPositions.delete(trade.tradeId);
        logger_1.logger.info(`Full exit [${reason}] for ${trade.tradeId} at $${executedPrice.toFixed(8)} | PnL: $${trade.realizedPnlUsd.toFixed(2)}`, {
            tradeId: trade.tradeId,
        });
        localFileLogger_1.LocalFileLogger.log(trade.realizedPnlUsd >= 0 ? 'INFO' : 'WARN', 'PositionManager', reason, `Full exit executed`, { executedPrice, pnl: trade.realizedPnlUsd }, { token: trade.tokenMint, pool: trade.poolAddress, tradeId: trade.tradeId });
        this.emit('fullExit', { trade, exitPrice: executedPrice, quantitySold, exitReason: reason, partial: false });
        repositories_1.Repositories.savePaperTrade(trade);
        repositories_1.Repositories.savePaperTradeExit(trade.tradeId, executedPrice, quantitySold, realizedPnl, reason, exitFees, exitSlippage);
    }
    forceExit(tradeId, currentPrice, reason) {
        const trade = this.openPositions.get(tradeId);
        if (!trade)
            return;
        this.triggerFullExit(trade, currentPrice, reason);
    }
}
exports.PositionManager = PositionManager;
