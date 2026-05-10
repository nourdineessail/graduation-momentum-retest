"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceEngine = void 0;
const constants_1 = require("../core/constants");
const logger_1 = require("../logging/logger");
class PriceEngine {
    // Live SOL price fetched from Binance public API. Defaults to 150 until first fetch.
    static MOCK_SOL_PRICE = 150.0;
    static pollInterval = null;
    static consecutiveFailures = 0;
    /**
     * Fetches live SOL/USDC price.
     * Primary: Binance public REST API (free, no key required).
     * Fallback: CoinGecko free tier (no key required).
     */
    static async fetchSolPrice() {
        // --- Primary: Binance ---
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDC', {
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) {
                const json = await response.json();
                const price = parseFloat(json.price);
                if (price > 0) {
                    this.MOCK_SOL_PRICE = price;
                    this.consecutiveFailures = 0;
                    logger_1.logger.info(`SOL price updated from Binance: $${price.toFixed(2)}`);
                    return;
                }
            }
        }
        catch (_binanceErr) {
            // Binance failed — try fallback
        }
        // --- Fallback: CoinGecko ---
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) {
                const json = await response.json();
                const price = json?.solana?.usd;
                if (price && price > 0) {
                    this.MOCK_SOL_PRICE = price;
                    this.consecutiveFailures = 0;
                    logger_1.logger.info(`SOL price updated from CoinGecko: $${price.toFixed(2)}`);
                    return;
                }
            }
        }
        catch (_geckoErr) {
            // Both failed
        }
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
            logger_1.logger.error(`SOL price fetch failed ${this.consecutiveFailures}x consecutively. Using last known: $${this.MOCK_SOL_PRICE.toFixed(2)}`);
        }
        else {
            logger_1.logger.warn(`SOL price fetch failed (attempt ${this.consecutiveFailures}). Using last known: $${this.MOCK_SOL_PRICE.toFixed(2)}`);
        }
    }
    static startPricePolling() {
        if (this.pollInterval)
            return;
        this.fetchSolPrice(); // fetch immediately
        this.pollInterval = setInterval(() => this.fetchSolPrice(), 60000); // every minute
    }
    static stopPricePolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
    static calculatePrice(baseVaultBalance, baseDecimals, quoteVaultBalance, quoteDecimals, quoteMint) {
        if (baseVaultBalance === 0n || quoteVaultBalance === 0n)
            return 0;
        const baseAmount = Number(baseVaultBalance) / Math.pow(10, baseDecimals);
        const quoteAmount = Number(quoteVaultBalance) / Math.pow(10, quoteDecimals);
        // CPMM price formula: Price = ReserveQuote / ReserveBase
        let priceInQuote = quoteAmount / baseAmount;
        // Convert to USD if quote is SOL
        if (quoteMint === constants_1.WSOL_MINT.toBase58()) {
            priceInQuote = priceInQuote * this.MOCK_SOL_PRICE;
        }
        return priceInQuote;
    }
    static calculateLiquidityUsd(quoteVaultBalance, quoteDecimals, quoteMint) {
        if (quoteVaultBalance === 0n)
            return 0;
        const quoteAmount = Number(quoteVaultBalance) / Math.pow(10, quoteDecimals);
        // Total liquidity in CPMM is roughly 2 * Quote Reserve Value
        let quoteUsdValue = quoteAmount;
        if (quoteMint === constants_1.WSOL_MINT.toBase58()) {
            quoteUsdValue = quoteAmount * this.MOCK_SOL_PRICE;
        }
        return quoteUsdValue * 2;
    }
}
exports.PriceEngine = PriceEngine;
