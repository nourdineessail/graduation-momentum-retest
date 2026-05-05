"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./config/env"); // Validate env first
const localFileLogger_1 = require("./logging/localFileLogger");
const logger_1 = require("./logging/logger");
const raydiumPoolWatcher_1 = require("./data/raydiumPoolWatcher");
const marketDataService_1 = require("./data/marketDataService");
const graduationMomentumRetest_1 = require("./strategy/graduationMomentumRetest");
const paperBroker_1 = require("./paper/paperBroker");
const positionManager_1 = require("./paper/positionManager");
const riskManager_1 = require("./risk/riskManager");
const performanceTracker_1 = require("./risk/performanceTracker");
const telegramNotifier_1 = require("./alerts/telegramNotifier");
const repositories_1 = require("./storage/repositories");
const time_1 = require("./utils/time");
const strategyConfig_1 = require("./config/strategyConfig");
const env_1 = require("./config/env");
// ─── Graceful Shutdown ───────────────────────────────────────────────────────
let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    logger_1.logger.info(`Received ${signal}. Shutting down gracefully...`);
    localFileLogger_1.LocalFileLogger.log('INFO', 'System', 'BOT_SHUTDOWN', `Shutdown signal: ${signal}`, {});
    poolWatcher.stop();
    marketDataService.stopPolling();
    performanceTracker.stop();
    localFileLogger_1.LocalFileLogger.shutdown();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection', { reason });
    localFileLogger_1.LocalFileLogger.log('ERROR', 'System', 'UNHANDLED_REJECTION', String(reason), {});
    repositories_1.Repositories.saveError('System', 'UnhandledRejection', String(reason), reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception', { err });
    localFileLogger_1.LocalFileLogger.log('ERROR', 'System', 'UNCAUGHT_EXCEPTION', err.message, { stack: err.stack });
    repositories_1.Repositories.saveError('System', 'UncaughtException', err.message, { stack: err.stack });
    process.exit(1);
});
// ─── Core Instances ──────────────────────────────────────────────────────────
localFileLogger_1.LocalFileLogger.init();
const positionManager = new positionManager_1.PositionManager();
const paperBroker = new paperBroker_1.PaperBroker(positionManager);
const riskManager = new riskManager_1.RiskManager();
const performanceTracker = new performanceTracker_1.PerformanceTracker();
const strategy = new graduationMomentumRetest_1.GraduationMomentumRetest();
const marketDataService = new marketDataService_1.MarketDataService();
const poolWatcher = new raydiumPoolWatcher_1.RaydiumPoolWatcher();
// Track last market data timestamp per pool for stale detection
const lastMarketUpdateMs = new Map();
// ─── Pool Watcher Events ─────────────────────────────────────────────────────
poolWatcher.on('newPool', async (pool) => {
    localFileLogger_1.LocalFileLogger.log('INFO', 'Main', 'POOL_DETECTED', `Pool: ${pool.poolAddress}`, pool, { token: pool.tokenMint, pool: pool.poolAddress });
    telegramNotifier_1.TelegramNotifier.poolDetected(pool.tokenMint, pool.poolAddress);
    marketDataService.watchPool(pool);
    await strategy.onPoolDetected(pool);
});
// ─── Market Data Events ──────────────────────────────────────────────────────
marketDataService.on('update', (poolAddress, marketData) => {
    lastMarketUpdateMs.set(poolAddress, marketData.timestamp);
    // Reject stale data
    if (riskManager.isDataStale(marketData.timestamp)) {
        logger_1.logger.warn(`Stale data for pool ${poolAddress}, skipping strategy eval`);
        return;
    }
    // Ticker: Age check — stop watching pools older than configured limit
    const poolInfo = strategy['stateMachine']?.getPoolInfo(poolAddress);
    if (poolInfo && (0, time_1.minutesSince)(poolInfo.createdAt) > strategyConfig_1.strategyConfig.MAX_TOKEN_AGE_MINUTES) {
        logger_1.logger.info(`Pool ${poolAddress} exceeded max age. Removing.`);
        marketDataService.unwatchPool(poolAddress);
        return;
    }
    // Update open positions with current price
    for (const position of positionManager.getOpenPositions()) {
        if (position.poolAddress === poolAddress) {
            positionManager.updatePosition(position.tradeId, marketData.price);
        }
    }
    strategy.onMarketDataUpdate(poolAddress, marketData);
});
// ─── Strategy Signal Events ───────────────────────────────────────────────────
strategy.on('signal', async (signal) => {
    const riskCheck = riskManager.canTrade(signal);
    if (!riskCheck.allowed) {
        logger_1.logger.warn(`Risk manager blocked trade: ${riskCheck.reason}`, { signalId: signal.id });
        localFileLogger_1.LocalFileLogger.log('WARN', 'RiskManager', 'ENTRY_BLOCKED', riskCheck.reason || 'Blocked', {}, { token: signal.tokenMint, pool: signal.poolAddress });
        performanceTracker.recordRejectedSignal();
        return;
    }
    if (!env_1.env.PAPER_TRADING) {
        logger_1.logger.warn('PAPER_TRADING=false — live trading not implemented. Skipping signal.');
        return;
    }
    const trade = await paperBroker.executeEntry(signal);
    if (trade) {
        riskManager.onTradeOpened(trade);
        performanceTracker.recordTrade(trade);
        telegramNotifier_1.TelegramNotifier.tradeOpened(trade.tradeId, trade.tokenMint, trade.entryPrice, trade.positionSizeUsd);
    }
});
// ─── Emergency Exit Event ─────────────────────────────────────────────────────
strategy.on('emergencyExit', (pool, reason) => {
    for (const position of positionManager.getOpenPositions()) {
        if (position.poolAddress === pool.poolAddress) {
            const lastData = lastMarketUpdateMs.get(pool.poolAddress);
            logger_1.logger.warn(`Emergency exit [${reason}] triggered for ${position.tradeId}`);
            // Use last known price approximation — this is the best we can do without market depth
            positionManager.forceExit(position.tradeId, position.entryPrice * 0.85, `EMERGENCY_${reason}`);
        }
    }
});
// ─── Position Exit Events ─────────────────────────────────────────────────────
positionManager.on('fullExit', async (event) => {
    riskManager.onTradeClosed(event.trade);
    performanceTracker.recordTrade(event.trade);
    strategy.notifyTradeClosed(event.trade.poolAddress);
    marketDataService.unwatchPool(event.trade.poolAddress);
    const isTP = event.exitReason?.includes('TAKE_PROFIT');
    const isSL = event.exitReason === 'STOP_LOSS';
    if (isSL)
        telegramNotifier_1.TelegramNotifier.stopLossHit(event.trade.tradeId, event.exitPrice, event.trade.realizedPnlUsd);
    telegramNotifier_1.TelegramNotifier.tradeClosed(event.trade.tradeId, event.exitReason, event.trade.realizedPnlUsd);
    await repositories_1.Repositories.logEvent('INFO', event.exitReason, `Trade closed: ${event.trade.tradeId}`, {
        tradeId: event.trade.tradeId,
        pnl: event.trade.realizedPnlUsd,
    });
});
positionManager.on('partialExit', async (event) => {
    performanceTracker.recordTrade(event.trade);
    const isTP1 = event.exitReason === 'TAKE_PROFIT_1';
    const isTP2 = event.exitReason === 'TAKE_PROFIT_2';
    if (isTP1)
        telegramNotifier_1.TelegramNotifier.takeProfitHit(event.trade.tradeId, 1, event.exitPrice, event.trade.realizedPnlUsd);
    if (isTP2)
        telegramNotifier_1.TelegramNotifier.takeProfitHit(event.trade.tradeId, 2, event.exitPrice, event.trade.realizedPnlUsd);
    await repositories_1.Repositories.logEvent('INFO', event.exitReason, `Partial exit: ${event.trade.tradeId}`, {
        tradeId: event.trade.tradeId,
        exitPrice: event.exitPrice,
        quantitySold: event.quantitySold,
    });
});
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    logger_1.logger.info('🚀 Graduation Momentum Retest Bot Starting...');
    localFileLogger_1.LocalFileLogger.log('INFO', 'System', 'BOT_STARTUP', 'Bot starting', { paperTrading: env_1.env.PAPER_TRADING });
    await telegramNotifier_1.TelegramNotifier.botStarted();
    marketDataService.startPolling(2000);
    performanceTracker.start();
    await poolWatcher.start();
    logger_1.logger.info('✅ Bot is running. Listening for new Raydium pools...');
    localFileLogger_1.LocalFileLogger.log('INFO', 'System', 'BOT_RUNNING', 'Listening for pools', {});
}
main().catch(err => {
    logger_1.logger.error('Fatal error during bot startup', { err });
    localFileLogger_1.LocalFileLogger.log('ERROR', 'System', 'STARTUP_ERROR', err.message, { stack: err.stack });
    process.exit(1);
});
