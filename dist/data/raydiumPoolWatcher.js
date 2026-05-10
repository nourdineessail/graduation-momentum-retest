"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaydiumPoolWatcher = void 0;
const solanaConnection_1 = require("./solanaConnection");
const constants_1 = require("../core/constants");
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
const events_1 = require("events");
const repositories_1 = require("../storage/repositories");
/**
 * RaydiumPoolWatcher — v5 (Performance Optimized)
 *
 * FIXES:
 * 1. Log Filtering: Only fetches TX if logs contain "Initialize2", "initialize_cpmm", or "create_pool".
 *    This prevents 429 rate limits by ignoring the 99% of log batches that are just swaps.
 * 2. Blacklist Expansion: Added correct ATA program, Jito accounts, and Memo program to prevent false detections.
 * 3. Polling Optimization: Polling is now a fallback, WSS is primary with strict log filtering.
 */
const PROGRAMS_TO_WATCH = [
    // { id: PUMP_FUN_MIGRATION_PROGRAM_ID, label: 'PumpMigration' }, // Disabled to prevent rate limits
    { id: constants_1.RAYDIUM_CPMM_PROGRAM_ID, label: 'RaydiumCPMM' },
    { id: constants_1.PUMP_FUN_AMM_PROGRAM_ID, label: 'PumpFunAMM' },
    { id: constants_1.RAYDIUM_V4_PROGRAM_ID, label: 'RaydiumV4' },
];
// Accounts that are definitely NOT pool addresses or tokens
const SYSTEM_PROGRAMS = new Set([
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
    '11111111111111111111111111111111', // System Program
    'SysvarRent111111111111111111111111111111111',
    'SysvarC1ock11111111111111111111111111111111',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // SPL ATA
    'ComputeBudget111111111111111111111111111111',
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo
    'jitodontfront111111111111111111111111111111', // Jito
    'jitodontfront111111111115111111111111165521', // Jito 2
    'JitoSPrRPuz77WSuAnSbaatbi9o5Vv3iXpxWvsh6CNo', // Jito Tip
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
    '6R5BzWXkTMwuRgumPHnEGMSpWqFxoW1NCKBnqdHoiDoW', // Jupiter
    'CcGdiJA7bbHR6aYjmatSnsW3WhXWwH2eQQh8JDtDSLd9',
    constants_1.RAYDIUM_V4_PROGRAM_ID.toBase58(),
    constants_1.RAYDIUM_CPMM_PROGRAM_ID.toBase58(),
    constants_1.PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
    constants_1.PUMP_FUN_MIGRATION_PROGRAM_ID.toBase58(),
]);
class RaydiumPoolWatcher extends events_1.EventEmitter {
    subscriptionIds = [];
    processedSignatures = new Set();
    watchedPools = new Set();
    pollInterval = null;
    lastSignatures = new Map();
    totalLogBatches = 0;
    diagnosticDumped = new Set();
    detectedCount = 0;
    lastPumpFunFetch = 0;
    async start() {
        logger_1.logger.info('🚀 Starting Pool Watcher — Optimized WSS + Polling');
        this.startWssSubscriptions();
        // Polling is less frequent now to save RPC credits
        await this.pollNow();
        this.pollInterval = setInterval(() => this.pollNow(), 30_000);
        logger_1.logger.info('✅ Pool Watcher active. Listening for "Initialize" events.');
    }
    stop() {
        for (const id of this.subscriptionIds) {
            try {
                solanaConnection_1.solanaConnection.connection.removeOnLogsListener(id);
            }
            catch { }
        }
        this.subscriptionIds = [];
        if (this.pollInterval)
            clearInterval(this.pollInterval);
    }
    startWssSubscriptions() {
        for (const prog of PROGRAMS_TO_WATCH) {
            const id = solanaConnection_1.solanaConnection.connection.onLogs(prog.id, (logs) => this.handleWssLog(logs, prog.label), 'confirmed');
            this.subscriptionIds.push(id);
        }
    }
    handleWssLog(logs, label) {
        if (logs.err)
            return;
        // Throttle Pump.fun token parsing to prevent 429 rate limit
        if (label === 'PumpFunAMM') {
            const now = Date.now();
            if (now - this.lastPumpFunFetch < 5000) {
                return; // Sample at max 1 tx per 5 seconds
            }
            this.lastPumpFunFetch = now;
        }
        this.totalLogBatches++;
        const isInit = logs.logs.some(log => {
            const l = log.toLowerCase();
            if (l.includes('initialize2') || l.includes('initializeinstruction2'))
                return true; // Raydium V4
            if (l.includes('instruction: create'))
                return true; // Pump.fun
            // CPMM initialization log. Ensure it's not a Token/ATA program log by excluding "account"
            if (l.includes('instruction: initialize') && !l.includes('account'))
                return true;
            return false;
        });
        if (!isInit)
            return;
        if (!this.processedSignatures.has(logs.signature)) {
            logger_1.logger.debug(`[PoolWatcher] Candidate found via WSS logs (${label}): ${logs.signature.slice(0, 8)}...`);
            this.processSignature(logs.signature, label).catch(() => { });
        }
    }
    async pollNow() {
        for (const prog of PROGRAMS_TO_WATCH) {
            await this.pollProgram(prog.id, prog.label);
        }
    }
    async pollProgram(programId, label) {
        try {
            const sigs = await solanaConnection_1.solanaConnection.connection.getSignaturesForAddress(programId, { limit: 10 }, 'confirmed');
            if (!sigs || sigs.length === 0)
                return;
            const lastSeen = this.lastSignatures.get(label);
            if (!lastSeen) {
                this.lastSignatures.set(label, sigs[0].signature);
                return;
            }
            const lastSeenIdx = sigs.findIndex(s => s.signature === lastSeen);
            const newSigs = lastSeenIdx === -1 ? sigs : sigs.slice(0, lastSeenIdx);
            this.lastSignatures.set(label, sigs[0].signature);
            for (const sig of newSigs.filter(s => !s.err)) {
                if (!this.processedSignatures.has(sig.signature)) {
                    await this.processSignature(sig.signature, label);
                }
            }
        }
        catch (err) {
            logger_1.logger.warn(`[PoolWatcher] Poll error for ${label}: ${String(err)}`);
        }
    }
    async processSignature(signature, sourceLabel) {
        if (this.processedSignatures.has(signature))
            return;
        this.processedSignatures.add(signature);
        try {
            const tx = await solanaConnection_1.solanaConnection.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!tx || !tx.transaction?.message)
                return;
            await this.extractPoolFromTransaction(tx, signature, sourceLabel);
        }
        catch (err) {
            const errStr = String(err);
            if (errStr.includes('429')) {
                logger_1.logger.warn(`[PoolWatcher] Rate limit (429) hit. Skipping TX ${signature.slice(0, 8)}...`);
            }
        }
    }
    async extractPoolFromTransaction(tx, signature, sourceLabel) {
        const message = tx.transaction.message;
        const accountKeys = message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
        const allAccounts = accountKeys.staticAccountKeys.map(k => k.toBase58());
        const lookupAccounts = accountKeys.accountKeysFromLookups;
        if (lookupAccounts) {
            lookupAccounts.writable.forEach(k => allAccounts.push(k.toBase58()));
            lookupAccounts.readonly.forEach(k => allAccounts.push(k.toBase58()));
        }
        const wsolStr = constants_1.WSOL_MINT.toBase58();
        const usdcStr = constants_1.USDC_MINT.toBase58();
        const candidates = [];
        const addCandidate = (amm, coin, bv, qv, quoteMint) => {
            if (SYSTEM_PROGRAMS.has(amm) || SYSTEM_PROGRAMS.has(coin))
                return;
            if (coin.startsWith('jitodont') || amm.startsWith('jitodont'))
                return;
            if (coin.startsWith('Sysvar') || amm.startsWith('Sysvar'))
                return;
            if (coin === wsolStr || coin === usdcStr)
                return;
            candidates.push({ poolAddress: amm, tokenMint: coin, quoteMint, baseVault: bv, quoteVault: qv });
        };
        const parseInstruction = (programId, accountIndexes) => {
            if (programId === constants_1.RAYDIUM_V4_PROGRAM_ID.toBase58() && accountIndexes.length >= 12) {
                const coinMint = allAccounts[accountIndexes[8]];
                const pcMint = allAccounts[accountIndexes[9]];
                const amm = allAccounts[accountIndexes[4]];
                if (pcMint === wsolStr || pcMint === usdcStr) {
                    addCandidate(amm, coinMint, allAccounts[accountIndexes[10]], allAccounts[accountIndexes[11]], pcMint);
                }
                else if (coinMint === wsolStr || coinMint === usdcStr) {
                    addCandidate(amm, pcMint, allAccounts[accountIndexes[11]], allAccounts[accountIndexes[10]], coinMint);
                }
            }
            else if (programId === constants_1.RAYDIUM_CPMM_PROGRAM_ID.toBase58() && accountIndexes.length >= 12) {
                const pool = allAccounts[accountIndexes[3]];
                const token0 = allAccounts[accountIndexes[4]];
                const token1 = allAccounts[accountIndexes[5]];
                if (token1 === wsolStr || token1 === usdcStr) {
                    addCandidate(pool, token0, allAccounts[accountIndexes[10]], allAccounts[accountIndexes[11]], token1);
                }
                else if (token0 === wsolStr || token0 === usdcStr) {
                    addCandidate(pool, token1, allAccounts[accountIndexes[11]], allAccounts[accountIndexes[10]], token0);
                }
            }
            else if (programId === constants_1.PUMP_FUN_AMM_PROGRAM_ID.toBase58() && accountIndexes.length >= 5) {
                const acc1 = allAccounts[accountIndexes[1]];
                const acc2 = allAccounts[accountIndexes[2]];
                const PUMPSWAP_CONFIG = 'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw';
                const pool = acc1 === PUMPSWAP_CONFIG ? acc2 : acc1;
                const tokenMint = allAccounts[accountIndexes[3]];
                const quoteMint = allAccounts[accountIndexes[4]];
                if (quoteMint === wsolStr || quoteMint === usdcStr) {
                    addCandidate(pool, tokenMint, pool, pool, quoteMint);
                }
                else if (tokenMint === wsolStr || tokenMint === usdcStr) {
                    addCandidate(pool, quoteMint, pool, pool, tokenMint);
                }
            }
        };
        for (const ix of message.compiledInstructions) {
            const programId = allAccounts[ix.programIdIndex];
            const accIndexes = ix.accounts || ix.accountKeyIndexes || [];
            parseInstruction(programId, accIndexes);
        }
        if (tx.meta?.innerInstructions) {
            for (const inner of tx.meta.innerInstructions) {
                for (const ix of inner.instructions) {
                    const programIdIdx = ix.programIdIndex;
                    if (programIdIdx !== undefined) {
                        const programId = allAccounts[programIdIdx];
                        const accIndexes = ix.accounts || ix.accountKeyIndexes || [];
                        parseInstruction(programId, accIndexes);
                    }
                }
            }
        }
        // 3. Process extracted candidates
        if (candidates.length === 0) {
            logger_1.logger.debug(`[PoolWatcher] TX ${signature.slice(0, 8)} (${sourceLabel}): No valid pool candidates extracted (heuristic mismatch)`);
        }
        for (const candidate of candidates) {
            if (this.watchedPools.has(candidate.poolAddress)) {
                logger_1.logger.debug(`[PoolWatcher] Pool ${candidate.poolAddress.slice(0, 8)} already watched, skipping`);
                continue;
            }
            this.watchedPools.add(candidate.poolAddress);
            this.detectedCount++;
            const poolInfo = {
                poolAddress: candidate.poolAddress,
                tokenMint: candidate.tokenMint,
                quoteMint: candidate.quoteMint,
                baseVault: candidate.baseVault,
                quoteVault: candidate.quoteVault,
                createdAt: new Date(),
            };
            logger_1.logger.info(`🎯 [NEW POOL] ${sourceLabel} | ${candidate.poolAddress} | token: ${candidate.tokenMint} | quote: ${candidate.quoteMint === wsolStr ? 'SOL' : 'USDC'}`);
            localFileLogger_1.LocalFileLogger.log('INFO', 'PoolWatcher', 'POOL_DETECTED', `Pool #${this.detectedCount}`, { ...poolInfo, signature });
            this.emit('newPool', poolInfo);
            await repositories_1.Repositories.saveDetectedPool(poolInfo);
        }
    }
}
exports.RaydiumPoolWatcher = RaydiumPoolWatcher;
