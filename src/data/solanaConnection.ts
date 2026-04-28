import { Connection, PublicKey } from '@solana/web3.js';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';

export class SolanaConnection {
  public connection: Connection;
  private wssHealthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.connection = this.createConnection();
    this.checkConnection();
    this.startWssHealthCheck();
  }

  private createConnection(): Connection {
    return new Connection(env.RPC_URL, {
      wsEndpoint: env.WSS_URL,
      commitment: 'confirmed',
      // Helius / dedicated RPC: disable fetch polyfill issues
      disableRetryOnRateLimit: false,
    });
  }

  private async checkConnection() {
    try {
      const version = await this.connection.getVersion();
      logger.info(`Connected to Solana cluster. Version: ${version['solana-core']}`);
      LocalFileLogger.log('INFO', 'SolanaConnection', 'RPC_CONNECTED', `Connected to cluster`, { version });
    } catch (error) {
      logger.error('Failed to connect to Solana cluster', { error });
      LocalFileLogger.log('ERROR', 'SolanaConnection', 'RPC_ERROR', 'Connection failed', { error: String(error) });
    }
  }

  /**
   * Helius WSS connections can silently drop. We ping with a slot request every 30 seconds.
   * If the connection is lost, web3.js will attempt a WSS reconnect automatically via
   * its internal _wsOnClose handler.
   */
  private startWssHealthCheck() {
    this.wssHealthCheckInterval = setInterval(async () => {
      try {
        await this.connection.getSlot('confirmed');
        logger.debug('[SolanaConnection] WSS health check OK');
      } catch (error) {
        logger.warn('[SolanaConnection] WSS health check failed — connection may have dropped', { error: String(error) });
        LocalFileLogger.log('WARN', 'SolanaConnection', 'WSS_UNHEALTHY', 'Health check failed, reconnecting', { error: String(error) });
      }
    }, 30_000);
  }

  public stopHealthCheck() {
    if (this.wssHealthCheckInterval) {
      clearInterval(this.wssHealthCheckInterval);
      this.wssHealthCheckInterval = null;
    }
  }

  public async getMultipleAccountsInfo(pubkeys: PublicKey[]) {
    try {
      return await this.connection.getMultipleAccountsInfo(pubkeys);
    } catch (error) {
      logger.error('Error fetching multiple accounts info', { error });
      throw error;
    }
  }

  public async getTokenSupply(mint: PublicKey) {
    try {
      return await this.connection.getTokenSupply(mint);
    } catch (error) {
      logger.error('Error fetching token supply', { error });
      throw error;
    }
  }
}

export const solanaConnection = new SolanaConnection();
