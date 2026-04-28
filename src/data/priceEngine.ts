import { USDC_MINT, WSOL_MINT } from '../core/constants';

export class PriceEngine {
  // Hardcoded SOL price for simulation purposes since we are isolated from a price oracle here.
  // In a real bot, we would fetch SOL/USDC price from Jupiter or Pyth.
  private static MOCK_SOL_PRICE = 150.0;

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
