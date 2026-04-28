"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramNotifier = void 0;
const env_1 = require("../config/env");
const retry_1 = require("../utils/retry");
class TelegramNotifier {
    static baseUrl = `https://api.telegram.org/bot${env_1.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    static enabled = !!(env_1.env.TELEGRAM_BOT_TOKEN && env_1.env.TELEGRAM_CHAT_ID);
    static async send(message) {
        if (!this.enabled)
            return;
        await (0, retry_1.retryWithBackoff)(async () => {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: env_1.env.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML',
                }),
            });
            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
            }
        }, { maxRetries: 3, label: 'TelegramNotifier.send' });
    }
    static async botStarted() {
        await this.send(`🤖 <b>Bot Started</b>\nGraduation Momentum Retest bot is online.`);
    }
    static async poolDetected(tokenMint, poolAddress) {
        await this.send(`🔭 <b>Pool Detected</b>\nToken: <code>${tokenMint}</code>\nPool: <code>${poolAddress}</code>`);
    }
    static async tradeOpened(tradeId, tokenMint, entryPrice, positionUsd) {
        await this.send(`✅ <b>Trade Opened</b>\nID: <code>${tradeId}</code>\nToken: <code>${tokenMint}</code>\nEntry: <b>$${entryPrice.toFixed(8)}</b>\nSize: <b>$${positionUsd.toFixed(2)}</b>`);
    }
    static async takeProfitHit(tradeId, level, price, pnl) {
        await this.send(`💰 <b>TP${level} Hit</b>\nID: <code>${tradeId}</code>\nPrice: <b>$${price.toFixed(8)}</b>\nPnL: <b>$${pnl.toFixed(2)}</b>`);
    }
    static async stopLossHit(tradeId, price, pnl) {
        await this.send(`🔴 <b>Stop Loss Hit</b>\nID: <code>${tradeId}</code>\nPrice: <b>$${price.toFixed(8)}</b>\nLoss: <b>$${pnl.toFixed(2)}</b>`);
    }
    static async tradeClosed(tradeId, reason, pnl) {
        const emoji = pnl >= 0 ? '🟢' : '🔴';
        await this.send(`${emoji} <b>Trade Closed</b>\nID: <code>${tradeId}</code>\nReason: ${reason}\nPnL: <b>$${pnl.toFixed(2)}</b>`);
    }
    static async criticalError(component, message) {
        await this.send(`🚨 <b>Critical Error</b>\nComponent: ${component}\nMessage: ${message}`);
    }
    static async dailySummary(stats) {
        await this.send(`📊 <b>Daily Summary</b>\nTrades: ${stats.totalTrades}\nWin Rate: ${stats.winRate.toFixed(1)}%\nPnL: <b>$${stats.realizedPnl.toFixed(2)}</b>\nProfit Factor: ${stats.profitFactor.toFixed(2)}`);
    }
}
exports.TelegramNotifier = TelegramNotifier;
