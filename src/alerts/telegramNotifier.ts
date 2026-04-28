import { env } from '../config/env';
import { logger } from '../logging/logger';
import { retryWithBackoff } from '../utils/retry';

export class TelegramNotifier {
  private static baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  private static enabled = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

  static async send(message: string): Promise<void> {
    if (!this.enabled) return;

    await retryWithBackoff(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
      }
    }, { maxRetries: 3, label: 'TelegramNotifier.send' });
  }

  static async botStarted(): Promise<void> {
    await this.send(`🤖 <b>Bot Started</b>\nGraduation Momentum Retest bot is online.`);
  }

  static async poolDetected(tokenMint: string, poolAddress: string): Promise<void> {
    await this.send(`🔭 <b>Pool Detected</b>\nToken: <code>${tokenMint}</code>\nPool: <code>${poolAddress}</code>`);
  }

  static async tradeOpened(tradeId: string, tokenMint: string, entryPrice: number, positionUsd: number): Promise<void> {
    await this.send(
      `✅ <b>Trade Opened</b>\nID: <code>${tradeId}</code>\nToken: <code>${tokenMint}</code>\nEntry: <b>$${entryPrice.toFixed(8)}</b>\nSize: <b>$${positionUsd.toFixed(2)}</b>`
    );
  }

  static async takeProfitHit(tradeId: string, level: number, price: number, pnl: number): Promise<void> {
    await this.send(
      `💰 <b>TP${level} Hit</b>\nID: <code>${tradeId}</code>\nPrice: <b>$${price.toFixed(8)}</b>\nPnL: <b>$${pnl.toFixed(2)}</b>`
    );
  }

  static async stopLossHit(tradeId: string, price: number, pnl: number): Promise<void> {
    await this.send(
      `🔴 <b>Stop Loss Hit</b>\nID: <code>${tradeId}</code>\nPrice: <b>$${price.toFixed(8)}</b>\nLoss: <b>$${pnl.toFixed(2)}</b>`
    );
  }

  static async tradeClosed(tradeId: string, reason: string, pnl: number): Promise<void> {
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    await this.send(
      `${emoji} <b>Trade Closed</b>\nID: <code>${tradeId}</code>\nReason: ${reason}\nPnL: <b>$${pnl.toFixed(2)}</b>`
    );
  }

  static async criticalError(component: string, message: string): Promise<void> {
    await this.send(`🚨 <b>Critical Error</b>\nComponent: ${component}\nMessage: ${message}`);
  }

  static async dailySummary(stats: {
    totalTrades: number;
    winRate: number;
    realizedPnl: number;
    profitFactor: number;
  }): Promise<void> {
    await this.send(
      `📊 <b>Daily Summary</b>\nTrades: ${stats.totalTrades}\nWin Rate: ${stats.winRate.toFixed(1)}%\nPnL: <b>$${stats.realizedPnl.toFixed(2)}</b>\nProfit Factor: ${stats.profitFactor.toFixed(2)}`
    );
  }
}
