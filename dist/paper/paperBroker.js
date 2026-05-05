"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaperBroker = void 0;
const strategyConfig_1 = require("../config/strategyConfig");
const executionSimulator_1 = require("./executionSimulator");
const repositories_1 = require("../storage/repositories");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
const ids_1 = require("../utils/ids");
const env_1 = require("../config/env");
class PaperBroker {
    positionManager;
    constructor(positionManager) {
        this.positionManager = positionManager;
    }
    async executeEntry(signal) {
        const positionSizeUsd = env_1.env.POSITION_SIZE_USD || strategyConfig_1.strategyConfig.POSITION_SIZE_USD;
        // Simulate market buy
        const sim = executionSimulator_1.ExecutionSimulator.simulateMarketOrder('BUY', signal.price, positionSizeUsd, signal.liquidityUsd);
        if (!sim.success) {
            logger_1.logger.warn(`Entry rejected by execution simulator: ${sim.reason}`, { signalId: signal.id });
            localFileLogger_1.LocalFileLogger.log('WARN', 'PaperBroker', 'ENTRY_REJECTED', sim.reason || 'Execution failed', { signalId: signal.id }, { token: signal.tokenMint, pool: signal.poolAddress });
            return null;
        }
        const tradeId = `paper_${(0, ids_1.generateId)()}`;
        const entryPrice = sim.executedPrice;
        const stopLossPrice = entryPrice * (1 - (env_1.env.STOP_LOSS_PERCENT || strategyConfig_1.strategyConfig.STOP_LOSS_PERCENT) / 100);
        const takeProfit1Price = entryPrice * (1 + (env_1.env.TAKE_PROFIT_1_PERCENT || strategyConfig_1.strategyConfig.TAKE_PROFIT_1_PERCENT) / 100);
        const takeProfit2Price = entryPrice * (1 + (env_1.env.TAKE_PROFIT_2_PERCENT || strategyConfig_1.strategyConfig.TAKE_PROFIT_2_PERCENT) / 100);
        const trailingStopPrice = entryPrice * (1 - strategyConfig_1.strategyConfig.TRAILING_STOP_PERCENT / 100);
        const trade = {
            id: (0, ids_1.generateId)(24),
            tradeId,
            tokenMint: signal.tokenMint,
            poolAddress: signal.poolAddress,
            strategyName: 'GraduationMomentumRetest',
            status: 'OPEN',
            entryTimestamp: new Date(),
            entryPrice,
            positionSizeUsd,
            tokenQuantity: sim.quantity,
            originalTokenQuantity: sim.quantity,
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
        await repositories_1.Repositories.savePaperTrade(trade);
        logger_1.logger.info(`Paper BUY executed: ${tradeId}`, {
            tokenMint: signal.tokenMint,
            entryPrice,
            quantity: sim.quantity,
            fees: sim.feesUsd,
            slippage: sim.slippageUsd,
        });
        localFileLogger_1.LocalFileLogger.log('INFO', 'PaperBroker', 'PAPER_BUY', `Paper trade opened at $${entryPrice.toFixed(8)}`, { entryPrice, quantity: sim.quantity, fees: sim.feesUsd, slippage: sim.slippageUsd, stopLossPrice, takeProfit1Price, takeProfit2Price }, { token: signal.tokenMint, pool: signal.poolAddress, tradeId });
        await repositories_1.Repositories.logEvent('INFO', 'PAPER_BUY', `Paper trade opened`, {
            tradeId,
            tokenMint: signal.tokenMint,
            poolAddress: signal.poolAddress,
            entryPrice,
        });
        return trade;
    }
}
exports.PaperBroker = PaperBroker;
