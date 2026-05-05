import { PublicKey } from '@solana/web3.js';
import { solanaConnection } from './solanaConnection';
import { PoolInfo, MarketData } from '../core/types';
import { PriceEngine } from './priceEngine';
import { logger } from '../logging/logger';
import { EventEmitter } from 'events';

export class MarketDataService extends EventEmitter {
  private watchedPools: Map<string, PoolInfo> = new Map();
  private poolHistory: Map<string, MarketData[]> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  public watchPool(pool: PoolInfo) {
    this.watchedPools.set(pool.poolAddress, pool);
    this.poolHistory.set(pool.poolAddress, []);
    logger.info(`MarketDataService watching pool: ${pool.poolAddress}`);
  }

  public unwatchPool(poolAddress: string) {
    this.watchedPools.delete(poolAddress);
    this.poolHistory.delete(poolAddress);
    logger.info(`MarketDataService unwatched pool: ${poolAddress}`);
  }

  public startPolling(intervalMs: number = 2000) {
    if (this.pollingInterval) return;
    logger.info(`Starting MarketDataService polling every ${intervalMs}ms`);
    this.pollingInterval = setInterval(() => this.poll(), intervalMs);
  }

  public stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async poll() {
    if (this.isPolling || this.watchedPools.size === 0) return;
    this.isPolling = true;

    try {
      const pools = Array.from(this.watchedPools.values());
      
      // Batch fetch vault accounts
      const vaultPubkeys: PublicKey[] = [];
      for (const pool of pools) {
        vaultPubkeys.push(new PublicKey(pool.baseVault));
        vaultPubkeys.push(new PublicKey(pool.quoteVault));
      }

      const accountInfos = await solanaConnection.getMultipleAccountsInfo(vaultPubkeys);

      for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];
        const baseVaultInfo = accountInfos[i * 2];
        const quoteVaultInfo = accountInfos[i * 2 + 1];

        if (!baseVaultInfo || !quoteVaultInfo) continue;

        // In a real implementation, we use SPL Token Account layout to decode the balance.
        // For this simulation, we'll approximate extraction from the raw data buffer.
        // The balance in an SPL Token Account is at offset 64, length 8 (u64).
        const baseBalance = baseVaultInfo.data.readBigUInt64LE(64);
        const quoteBalance = quoteVaultInfo.data.readBigUInt64LE(64);

        // Approximation for decimals. Ideally, fetch mint info once.
        const baseDecimals = 6; // Typical for memecoins
        const quoteDecimals = pool.quoteMint.includes('EPj') ? 6 : 9; // USDC: 6, SOL: 9

        const price = PriceEngine.calculatePrice(baseBalance, baseDecimals, quoteBalance, quoteDecimals, pool.quoteMint);
        const liquidityUsd = PriceEngine.calculateLiquidityUsd(quoteBalance, quoteDecimals, pool.quoteMint);

        this.updateMarketData(pool.poolAddress, price, liquidityUsd, Number(quoteBalance));
      }

    } catch (error) {
      logger.error('Error polling market data', { error });
    } finally {
      this.isPolling = false;
    }
  }

  private updateMarketData(poolAddress: string, currentPrice: number, liquidityUsd: number, currentQuoteBalance: number) {
    const history = this.poolHistory.get(poolAddress);
    if (!history) return;

    let localHigh = currentPrice;
    let localLow = currentPrice;
    let vwap = currentPrice;
    let pullbackPercent = 0;
    
    let quoteVaultDeltaUsd = 0;
    let netBuyPressure = 1.0;
    let flowDirection: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';

    if (history.length > 0) {
      const last = history[history.length - 1];
      // We calculate net volume by tracking the difference in the quote token vault balance.
      // An increase in Quote vault means net buys; decrease means net sells.
      // To get delta USD, we approximate the difference in balance * current price.
      // (This is a simplified estimation since PriceEngine handles decimals, we just use the ratio of liquidityUsd).
      // Assuming liquidityUsd is proportional to quoteBalance.
      const lastQuoteBalance = (last as any)._quoteBalance || currentQuoteBalance;
      const quoteDeltaNative = currentQuoteBalance - lastQuoteBalance;
      
      // Calculate delta in USD. If quoteBalance is 0, avoid div by zero.
      if (currentQuoteBalance > 0) {
        quoteVaultDeltaUsd = (quoteDeltaNative / currentQuoteBalance) * liquidityUsd;
      }
      
      if (quoteVaultDeltaUsd > 0) {
        flowDirection = 'BUY';
        netBuyPressure = 1.0 + (quoteVaultDeltaUsd / liquidityUsd) * 100; // Positive pressure scalar
      } else if (quoteVaultDeltaUsd < 0) {
        flowDirection = 'SELL';
        netBuyPressure = 1.0 / (1.0 + Math.abs(quoteVaultDeltaUsd / liquidityUsd) * 100); // Negative pressure scalar
      }

      localHigh = Math.max(...history.map(h => h.price), currentPrice);
      localLow = Math.min(...history.map(h => h.price), currentPrice);
      
      if (localHigh > 0) {
        pullbackPercent = ((localHigh - currentPrice) / localHigh) * 100;
      }
      
      // Approximation of VWAP
      const sumPrice = history.reduce((sum, h) => sum + h.price, 0) + currentPrice;
      vwap = sumPrice / (history.length + 1);
    }

    const newData: MarketData = {
      timestamp: Date.now(),
      dataQuality: 'PARTIAL',
      price: currentPrice,
      liquidityUsd,
      localHigh,
      localLow,
      pullbackPercent,
      vwap,
      quoteVaultDeltaUsd,
      netBuyPressure,
      flowDirection,
      uniqueBuyers: null,
      uniqueSellers: null,
    };

    // Store raw balance temporarily for the next delta calculation
    (newData as any)._quoteBalance = currentQuoteBalance;

    history.push(newData);
    
    // Keep history bounded
    if (history.length > 1000) {
      history.shift();
    }

    this.emit('update', poolAddress, newData);
  }
}
