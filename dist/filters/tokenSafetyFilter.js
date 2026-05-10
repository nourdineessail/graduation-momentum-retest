"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenSafetyFilter = void 0;
const web3_js_1 = require("@solana/web3.js");
const solanaConnection_1 = require("../data/solanaConnection");
const logger_1 = require("../logging/logger");
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class TokenSafetyFilter {
    /**
     * Performs deep safety checks on the token mint:
     * 1. Verifies token supply exists.
     * 2. Verifies mintAuthority is disabled (null).
     * 3. Verifies freezeAuthority is disabled (null).
     * 4. Checks holder concentration (excluding top AMM vault).
     */
    static async checkSafety(params) {
        const mintPubKey = new web3_js_1.PublicKey(params.tokenMint);
        let lastError = null;
        // Retry loop for RPC consistency issues (load balancers hitting lagging nodes)
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
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
                    return { passed: false, reason: 'Mint info is not parsed JSON' };
                }
                // @ts-ignore
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
                // Assume the #1 largest account is the Raydium/PumpSwap AMM vault if not known.
                // We exclude the known baseVault.
                const excludedTokenAccounts = new Set([params.baseVault]);
                const nonAmmHolders = largestAccounts.value.filter(account => !excludedTokenAccounts.has(account.address.toString()));
                if (nonAmmHolders.length > 0) {
                    const largestNonAmmHolder = nonAmmHolders[0];
                    const holderAmount = Number(largestNonAmmHolder.uiAmount);
                    const holderPercent = (holderAmount / totalSupply) * 100;
                    if (holderPercent > 20) {
                        return { passed: false, reason: `Top holder concentration too high: ${holderPercent.toFixed(2)}%` };
                    }
                }
                return { passed: true };
            }
            catch (error) {
                lastError = error;
                const errStr = error instanceof Error ? error.message : String(error);
                // If it's a known RPC consistency issue ("not a Token mint"), wait and retry
                if (errStr.includes('not a Token mint') && attempt < 3) {
                    logger_1.logger.warn(`RPC lag detected for ${params.tokenMint} (attempt ${attempt}/3). Retrying in 1000ms...`);
                    await delay(1000);
                    continue;
                }
                // Other errors or max attempts reached
                logger_1.logger.error(`Safety check failed on attempt ${attempt}`, { tokenMint: params.tokenMint, error: errStr });
                return { passed: false, reason: `RPC error: ${errStr}` };
            }
        }
        return { passed: false, reason: `RPC error: ${lastError instanceof Error ? lastError.message : String(lastError)}` };
    }
}
exports.TokenSafetyFilter = TokenSafetyFilter;
