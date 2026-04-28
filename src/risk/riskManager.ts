import { PaperTrade } from '../core/types';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';

// All thresholds configurable here
const RISK_CONFIG = {
  MAX_OPEN_POSITIONS: 3,
  MAX_TRADES_PER_HOUR: 10,
  MAX_DAILY_LOSS_USD: 100,
  MAX_CONSECUTIVE_LOSSES: 4,
  COOLDOWN_AFTER_LOSSES_MINUTES: 30,
  PER_TOKEN_COOLDOWN_MINUTES: 60,
  STALE_DATA_MAX_SECONDS: 20,
};

export class RiskManager {
  private openPositions: Map<string, PaperTrade> = new Map();
  private tradeTimestamps: number[] = [];
  private consecutiveLosses = 0;
  private cooldownUntil: number | null = null;
  private tokenCooldowns: Map<string, number> = new Map();
  private dailyRealizedPnl = 0;
  private lastResetDay = new Date().toDateString();
  private seenSignals: Set<string> = new Set();

  public onTradeOpened(trade: PaperTrade) {
    this.openPositions.set(trade.tradeId, trade);
    this.tradeTimestamps.push(Date.now());
  }

  public onTradeClosed(trade: PaperTrade) {
    this.openPositions.delete(trade.tradeId);

    this.dailyPnlReset();
    this.dailyRealizedPnl += trade.realizedPnlUsd;

    if (trade.realizedPnlUsd < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= RISK_CONFIG.MAX_CONSECUTIVE_LOSSES) {
        this.cooldownUntil = Date.now() + RISK_CONFIG.COOLDOWN_AFTER_LOSSES_MINUTES * 60 * 1000;
        logger.warn(`RiskManager: Cooldown activated after ${this.consecutiveLosses} consecutive losses until ${new Date(this.cooldownUntil).toISOString()}`);
        LocalFileLogger.log('WARN', 'RiskManager', 'COOLDOWN_ACTIVE', `Cooldown after ${this.consecutiveLosses} losses`, { cooldownUntil: this.cooldownUntil });
      }
      // Per-token cooldown
      this.tokenCooldowns.set(trade.tokenMint, Date.now() + RISK_CONFIG.PER_TOKEN_COOLDOWN_MINUTES * 60 * 1000);
    } else {
      this.consecutiveLosses = 0;
    }
  }

  public canTrade(signal: { id: string; tokenMint: string; liquidityUsd: number }): { allowed: boolean; reason?: string } {
    // Duplicate signal prevention
    if (this.seenSignals.has(signal.id)) {
      return { allowed: false, reason: 'Duplicate signal' };
    }
    this.seenSignals.add(signal.id);

    // Daily loss limit
    this.dailyPnlReset();
    if (this.dailyRealizedPnl <= -RISK_CONFIG.MAX_DAILY_LOSS_USD) {
      return { allowed: false, reason: `Daily loss limit hit: $${this.dailyRealizedPnl.toFixed(2)}` };
    }

    // Cooldown check
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      return { allowed: false, reason: `In cooldown until ${new Date(this.cooldownUntil).toISOString()}` };
    } else {
      this.cooldownUntil = null;
    }

    // Max open positions
    if (this.openPositions.size >= RISK_CONFIG.MAX_OPEN_POSITIONS) {
      return { allowed: false, reason: `Max open positions (${RISK_CONFIG.MAX_OPEN_POSITIONS}) reached` };
    }

    // Max trades per hour
    const oneHourAgo = Date.now() - 3600 * 1000;
    const recentTrades = this.tradeTimestamps.filter(ts => ts > oneHourAgo);
    if (recentTrades.length >= RISK_CONFIG.MAX_TRADES_PER_HOUR) {
      return { allowed: false, reason: `Max trades per hour (${RISK_CONFIG.MAX_TRADES_PER_HOUR}) reached` };
    }

    // Per-token cooldown
    const tokenCooldown = this.tokenCooldowns.get(signal.tokenMint);
    if (tokenCooldown && Date.now() < tokenCooldown) {
      return { allowed: false, reason: `Token ${signal.tokenMint} in per-token cooldown` };
    }

    return { allowed: true };
  }

  public isDataStale(lastUpdateMs: number): boolean {
    const ageSec = (Date.now() - lastUpdateMs) / 1000;
    return ageSec > RISK_CONFIG.STALE_DATA_MAX_SECONDS;
  }

  private dailyPnlReset() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      this.dailyRealizedPnl = 0;
      this.lastResetDay = today;
      logger.info('RiskManager: Daily P&L reset');
    }
  }
}
