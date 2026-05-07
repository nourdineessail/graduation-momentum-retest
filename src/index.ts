import './config/env'; // Validate env first
import { LocalFileLogger } from './logging/localFileLogger';
import { logger } from './logging/logger';
import { RaydiumPoolWatcher } from './data/raydiumPoolWatcher';
import { MarketDataService } from './data/marketDataService';
import { GraduationMomentumRetest } from './strategy/graduationMomentumRetest';
import { PaperBroker } from './paper/paperBroker';
import { PositionManager } from './paper/positionManager';
import { RiskManager } from './risk/riskManager';
import { PerformanceTracker } from './risk/performanceTracker';
import { TelegramNotifier } from './alerts/telegramNotifier';
import { Repositories } from './storage/repositories';
import { PoolInfo, Signal, MarketData } from './core/types';
import { minutesSince } from './utils/time';
import { strategyConfig } from './config/strategyConfig';
import { env } from './config/env';

import { PriceEngine } from './data/priceEngine';

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Shutting down gracefully...`);
  LocalFileLogger.log('INFO', 'System', 'BOT_SHUTDOWN', `Shutdown signal: ${signal}`, {});

  poolWatcher.stop();
  marketDataService.stopPolling();
  performanceTracker.stop();
  PriceEngine.stopPricePolling();

  LocalFileLogger.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  LocalFileLogger.log('ERROR', 'System', 'UNHANDLED_REJECTION', String(reason), {});
  Repositories.saveError('System', 'UnhandledRejection', String(reason), reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  LocalFileLogger.log('ERROR', 'System', 'UNCAUGHT_EXCEPTION', err.message, { stack: err.stack });
  Repositories.saveError('System', 'UncaughtException', err.message, { stack: err.stack });
  process.exit(1);
});

// ─── Core Instances ──────────────────────────────────────────────────────────
LocalFileLogger.init();
PriceEngine.startPricePolling();

const positionManager = new PositionManager();
const paperBroker = new PaperBroker(positionManager);
const riskManager = new RiskManager();
const performanceTracker = new PerformanceTracker();
const strategy = new GraduationMomentumRetest();
const marketDataService = new MarketDataService();
const poolWatcher = new RaydiumPoolWatcher();

// Track last market data per pool for stale detection and emergency exits
const lastMarketData: Map<string, MarketData> = new Map();

// ─── Pool Watcher Events ─────────────────────────────────────────────────────
poolWatcher.on('newPool', async (pool: PoolInfo) => {
  LocalFileLogger.log('INFO', 'Main', 'POOL_DETECTED', `Pool: ${pool.poolAddress}`, pool, { token: pool.tokenMint, pool: pool.poolAddress });
  TelegramNotifier.poolDetected(pool.tokenMint, pool.poolAddress);
  marketDataService.watchPool(pool);
  await strategy.onPoolDetected(pool);
});

// ─── Market Data Events ──────────────────────────────────────────────────────
marketDataService.on('update', (poolAddress: string, marketData: MarketData) => {
  lastMarketData.set(poolAddress, marketData);

  // Reject stale data
  if (riskManager.isDataStale(marketData.timestamp)) {
    logger.warn(`Stale data for pool ${poolAddress}, skipping strategy eval`);
    return;
  }

  // Ticker: Age check — stop watching pools older than configured limit
  const poolInfo = strategy['stateMachine']?.getPoolInfo(poolAddress);
  if (poolInfo && minutesSince(poolInfo.createdAt) > strategyConfig.MAX_TOKEN_AGE_MINUTES) {
    logger.info(`Pool ${poolAddress} exceeded max age. Removing.`);
    marketDataService.unwatchPool(poolAddress);
    return;
  }

  // Update open positions with current price
  for (const position of positionManager.getOpenPositions()) {
    if (position.poolAddress === poolAddress) {
      positionManager.updatePosition(position.tradeId, marketData.price, marketData.liquidityUsd);
    }
  }

  strategy.onMarketDataUpdate(poolAddress, marketData);
});

// ─── Strategy Signal Events ───────────────────────────────────────────────────
strategy.on('signal', async (signal: Signal) => {
  const riskCheck = riskManager.canTrade(signal);
  if (!riskCheck.allowed) {
    logger.warn(`Risk manager blocked trade: ${riskCheck.reason}`, { signalId: signal.id });
    LocalFileLogger.log('WARN', 'RiskManager', 'ENTRY_BLOCKED', riskCheck.reason || 'Blocked', {}, { token: signal.tokenMint, pool: signal.poolAddress });
    performanceTracker.recordRejectedSignal();
    return;
  }

  if (!env.PAPER_TRADING) {
    logger.warn('PAPER_TRADING=false — live trading not implemented. Skipping signal.');
    return;
  }

  const trade = await paperBroker.executeEntry(signal);
  if (trade) {
    riskManager.onTradeOpened(trade);
    performanceTracker.recordTrade(trade);
    TelegramNotifier.tradeOpened(trade.tradeId, trade.tokenMint, trade.entryPrice, trade.positionSizeUsd);
  }
});

// ─── Emergency Exit Event ─────────────────────────────────────────────────────
strategy.on('emergencyExit', (pool: PoolInfo, reason: string) => {
  for (const position of positionManager.getOpenPositions()) {
    if (position.poolAddress === pool.poolAddress) {
      const lastData = lastMarketData.get(pool.poolAddress);
      logger.warn(`Emergency exit [${reason}] triggered for ${position.tradeId}`);
      // Use last known price and liquidity approximation
      const exitPrice = lastData ? lastData.price : position.entryPrice * 0.85;
      const liquidityUsd = lastData ? lastData.liquidityUsd : 0;
      positionManager.forceExit(position.tradeId, exitPrice, `EMERGENCY_${reason}`, liquidityUsd);
    }
  }
});

// ─── Position Exit Events ─────────────────────────────────────────────────────
positionManager.on('fullExit', async (event: any) => {
  riskManager.onTradeClosed(event.trade);
  performanceTracker.recordTrade(event.trade);
  strategy.notifyTradeClosed(event.trade.poolAddress);
  marketDataService.unwatchPool(event.trade.poolAddress);

  const isTP = event.exitReason?.includes('TAKE_PROFIT');
  const isSL = event.exitReason === 'STOP_LOSS';

  if (isSL) TelegramNotifier.stopLossHit(event.trade.tradeId, event.exitPrice, event.trade.realizedPnlUsd);
  TelegramNotifier.tradeClosed(event.trade.tradeId, event.exitReason, event.trade.realizedPnlUsd);

  await Repositories.logEvent('INFO', event.exitReason, `Trade closed: ${event.trade.tradeId}`, {
    tradeId: event.trade.tradeId,
    pnl: event.trade.realizedPnlUsd,
  });
});

positionManager.on('partialExit', async (event: any) => {
  performanceTracker.recordTrade(event.trade);
  const isTP1 = event.exitReason === 'TAKE_PROFIT_1';
  const isTP2 = event.exitReason === 'TAKE_PROFIT_2';

  if (isTP1) TelegramNotifier.takeProfitHit(event.trade.tradeId, 1, event.exitPrice, event.trade.realizedPnlUsd);
  if (isTP2) TelegramNotifier.takeProfitHit(event.trade.tradeId, 2, event.exitPrice, event.trade.realizedPnlUsd);

  await Repositories.logEvent('INFO', event.exitReason, `Partial exit: ${event.trade.tradeId}`, {
    tradeId: event.trade.tradeId,
    exitPrice: event.exitPrice,
    quantitySold: event.quantitySold,
  });
});

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  logger.info('🚀 Graduation Momentum Retest Bot Starting...');
  LocalFileLogger.log('INFO', 'System', 'BOT_STARTUP', 'Bot starting', { paperTrading: env.PAPER_TRADING });

  await TelegramNotifier.botStarted();

  marketDataService.startPolling(2000);
  performanceTracker.start();
  await poolWatcher.start();

  logger.info('✅ Bot is running. Listening for new Raydium pools...');
  LocalFileLogger.log('INFO', 'System', 'BOT_RUNNING', 'Listening for pools', {});
}

main().catch(err => {
  logger.error('Fatal error during bot startup', { err });
  LocalFileLogger.log('ERROR', 'System', 'STARTUP_ERROR', err.message, { stack: err.stack });
  process.exit(1);
});
