"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.solanaConnection = exports.SolanaConnection = void 0;
const web3_js_1 = require("@solana/web3.js");
const env_1 = require("../config/env");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
class SolanaConnection {
    connection;
    wssHealthCheckInterval = null;
    constructor() {
        this.connection = this.createConnection();
        this.checkConnection();
        this.startWssHealthCheck();
    }
    createConnection() {
        return new web3_js_1.Connection(env_1.env.RPC_URL, {
            wsEndpoint: env_1.env.WSS_URL,
            commitment: 'confirmed',
            // Helius / dedicated RPC: disable fetch polyfill issues
            disableRetryOnRateLimit: false,
        });
    }
    async checkConnection() {
        try {
            const version = await this.connection.getVersion();
            logger_1.logger.info(`Connected to Solana cluster. Version: ${version['solana-core']}`);
            localFileLogger_1.LocalFileLogger.log('INFO', 'SolanaConnection', 'RPC_CONNECTED', `Connected to cluster`, { version });
        }
        catch (error) {
            logger_1.logger.error('Failed to connect to Solana cluster', { error });
            localFileLogger_1.LocalFileLogger.log('ERROR', 'SolanaConnection', 'RPC_ERROR', 'Connection failed', { error: String(error) });
        }
    }
    /**
     * Helius WSS connections can silently drop. We ping with a slot request every 30 seconds.
     * If the connection is lost, web3.js will attempt a WSS reconnect automatically via
     * its internal _wsOnClose handler.
     */
    startWssHealthCheck() {
        this.wssHealthCheckInterval = setInterval(async () => {
            try {
                await this.connection.getSlot('confirmed');
                logger_1.logger.debug('[SolanaConnection] WSS health check OK');
            }
            catch (error) {
                logger_1.logger.warn('[SolanaConnection] WSS health check failed — connection may have dropped', { error: String(error) });
                localFileLogger_1.LocalFileLogger.log('WARN', 'SolanaConnection', 'WSS_UNHEALTHY', 'Health check failed, reconnecting', { error: String(error) });
            }
        }, 30_000);
    }
    stopHealthCheck() {
        if (this.wssHealthCheckInterval) {
            clearInterval(this.wssHealthCheckInterval);
            this.wssHealthCheckInterval = null;
        }
    }
    async getMultipleAccountsInfo(pubkeys) {
        try {
            return await this.connection.getMultipleAccountsInfo(pubkeys);
        }
        catch (error) {
            logger_1.logger.error('Error fetching multiple accounts info', { error });
            throw error;
        }
    }
    async getTokenSupply(mint) {
        try {
            return await this.connection.getTokenSupply(mint);
        }
        catch (error) {
            logger_1.logger.error('Error fetching token supply', { error });
            throw error;
        }
    }
}
exports.SolanaConnection = SolanaConnection;
exports.solanaConnection = new SolanaConnection();
