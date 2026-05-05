"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenSafetyFilter = void 0;
const web3_js_1 = require("@solana/web3.js");
const solanaConnection_1 = require("../data/solanaConnection");
const logger_1 = require("../logging/logger");
class TokenSafetyFilter {
    /**
     * Performs deep safety checks on the token mint:
     * 1. Verifies token supply exists.
     * 2. Verifies mintAuthority is disabled (null).
     * 3. Verifies freezeAuthority is disabled (null).
     * 4. Checks holder concentration (excluding top AMM vault).
     */
    static async checkSafety(tokenMint) {
        try {
            const mintPubKey = new web3_js_1.PublicKey(tokenMint);
            // 1. Get Token Supply to ensure it exists
            const supplyRes = await solanaConnection_1.solanaConnection.connection.getTokenSupply(mintPubKey);
            const totalSupply = Number(supplyRes.value.uiAmount);
            if (!totalSupply || totalSupply === 0) {
                return { passed: false, reason: 'Zero or invalid token supply' };
            }
            // 2 & 3. Check Mint and Freeze Authorities
            const parsedInfo = await solanaConnection_1.solanaConnection.connection.getParsedAccountInfo(mintPubKey);
            if (!parsedInfo.value) {
                return { passed: false, reason: 'Failed to fetch parsed mint info' };
            }
            const data = parsedInfo.value.data;
            if (Buffer.isBuffer(data)) {
                // In some RPC setups getParsedAccountInfo might fall back to buffer if not recognized.
                // But for SPL tokens, it should be parsed.
                return { passed: false, reason: 'Mint info is not parsed JSON' };
            }
            // @ts-ignore - The parsed object has a specific structure for spl-token
            const mintInfo = data.parsed?.info;
            if (!mintInfo) {
                return { passed: false, reason: 'Could not extract mint info from parsed data' };
            }
            if (mintInfo.mintAuthority !== null) {
                return { passed: false, reason: `Mint authority is active: ${mintInfo.mintAuthority}` };
            }
            if (mintInfo.freezeAuthority !== null) {
                return { passed: false, reason: `Freeze authority is active: ${mintInfo.freezeAuthority}` };
            }
            // 4. Check Holder Concentration
            const largestAccounts = await solanaConnection_1.solanaConnection.connection.getTokenLargestAccounts(mintPubKey);
            if (!largestAccounts.value || largestAccounts.value.length === 0) {
                return { passed: false, reason: 'Could not fetch token largest accounts' };
            }
            // Assume the #1 largest account is the Raydium/PumpSwap AMM vault.
            // We check the #2 account (the largest non-AMM holder).
            if (largestAccounts.value.length > 1) {
                const largestNonAmmHolder = largestAccounts.value[1];
                const holderAmount = Number(largestNonAmmHolder.uiAmount);
                const holderPercent = (holderAmount / totalSupply) * 100;
                if (holderPercent > 20) {
                    return { passed: false, reason: `Top holder concentration too high: ${holderPercent.toFixed(2)}%` };
                }
            }
            return { passed: true };
        }
        catch (error) {
            logger_1.logger.error('Safety check failed', { tokenMint, error });
            return { passed: false, reason: 'Failed to fetch token data from RPC' };
        }
    }
}
exports.TokenSafetyFilter = TokenSafetyFilter;
