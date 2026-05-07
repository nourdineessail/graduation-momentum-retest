import { USDC_MINT, WSOL_MINT } from '../core/constants';

import { logger } from '../logging/logger';

export class PriceEngine {
  // Live SOL price fetched from Jupiter. Defaults to 150 until first fetch.
  public static MOCK_SOL_PRICE = 150.0;
  private static pollInterval: NodeJS.Timeout | null = null;

  static async fetchSolPrice() {
    try {
      const response = await fetch('https://price.jup.ag/v6/price?ids=SOL');
      if (response.ok) {
        const json = await response.json();
        if (json.data && json.data.SOL && json.data.SOL.price) {
          this.MOCK_SOL_PRICE = json.data.SOL.price;
        }
      }
    } catch (err) {
      logger.warn('Failed to fetch SOL price from Jupiter', { err });
    }
  }

  static startPricePolling() {
    if (this.pollInterval) return;
    this.fetchSolPrice(); // fetch immediately
    this.pollInterval = setInterval(() => this.fetchSolPrice(), 60000); // every minute
  }

  static stopPricePolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  static calculatePrice(
    baseVaultBalance: bigint,
    baseDecimals: number,
    quoteVaultBalance: bigint,
    quoteDecimals: number,
    quoteMint: string
  ): number {
    if (baseVaultBalance === 0n || quoteVaultBalance === 0n) return 0;

    const baseAmount = Number(baseVaultBalance) / Math.pow(10, baseDecimals);
    const quoteAmount = Number(quoteVaultBalance) / Math.pow(10, quoteDecimals);

    // CPMM price formula: Price = ReserveQuote / ReserveBase
    let priceInQuote = quoteAmount / baseAmount;

    // Convert to USD if quote is SOL
    if (quoteMint === WSOL_MINT.toBase58()) {
      priceInQuote = priceInQuote * this.MOCK_SOL_PRICE;
    }

    return priceInQuote;
  }

  static calculateLiquidityUsd(
    quoteVaultBalance: bigint,
    quoteDecimals: number,
    quoteMint: string
  ): number {
    if (quoteVaultBalance === 0n) return 0;

    const quoteAmount = Number(quoteVaultBalance) / Math.pow(10, quoteDecimals);

    // Total liquidity in CPMM is roughly 2 * Quote Reserve Value
    let quoteUsdValue = quoteAmount;
    if (quoteMint === WSOL_MINT.toBase58()) {
      quoteUsdValue = quoteAmount * this.MOCK_SOL_PRICE;
    }

    return quoteUsdValue * 2;
  }
}
