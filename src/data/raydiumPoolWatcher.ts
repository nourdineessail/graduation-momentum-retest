import { PublicKey, VersionedTransactionResponse, ConfirmedSignatureInfo } from '@solana/web3.js';
import { solanaConnection } from './solanaConnection';
import {
  RAYDIUM_V4_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  PUMP_FUN_AMM_PROGRAM_ID,
  PUMP_FUN_MIGRATION_PROGRAM_ID,
  WSOL_MINT,
  USDC_MINT,
} from '../core/constants';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';
import { EventEmitter } from 'events';
import { PoolInfo } from '../core/types';
import { Repositories } from '../storage/repositories';

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
  { id: PUMP_FUN_MIGRATION_PROGRAM_ID, label: 'PumpMigration' },
  { id: RAYDIUM_CPMM_PROGRAM_ID,       label: 'RaydiumCPMM'   },
  { id: PUMP_FUN_AMM_PROGRAM_ID,       label: 'PumpFunAMM'    },
  { id: RAYDIUM_V4_PROGRAM_ID,         label: 'RaydiumV4'     },
];

// Accounts that are definitely NOT pool addresses or tokens
const SYSTEM_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  '11111111111111111111111111111111',           // System Program
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
  RAYDIUM_V4_PROGRAM_ID.toBase58(),
  RAYDIUM_CPMM_PROGRAM_ID.toBase58(),
  PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
  PUMP_FUN_MIGRATION_PROGRAM_ID.toBase58(),
]);

export class RaydiumPoolWatcher extends EventEmitter {
  private subscriptionIds: number[] = [];
  private processedSignatures: Set<string> = new Set();
  private watchedPools: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSignatures: Map<string, string> = new Map();

  private totalLogBatches = 0;
  private diagnosticDumped: Set<string> = new Set();
  private detectedCount = 0;

  public async start() {
    logger.info('🚀 Starting Pool Watcher — Optimized WSS + Polling');
    this.startWssSubscriptions();
    
    // Polling is less frequent now to save RPC credits
    await this.pollNow();
    this.pollInterval = setInterval(() => this.pollNow(), 30_000); 

    logger.info('✅ Pool Watcher active. Listening for "Initialize" events.');
  }

  public stop() {
    for (const id of this.subscriptionIds) {
      try { solanaConnection.connection.removeOnLogsListener(id); } catch {}
    }
    this.subscriptionIds = [];
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private startWssSubscriptions() {
    for (const prog of PROGRAMS_TO_WATCH) {
      const id = solanaConnection.connection.onLogs(
        prog.id,
        (logs) => this.handleWssLog(logs, prog.label),
        'confirmed'
      );
      this.subscriptionIds.push(id);
    }
  }

  private handleWssLog(logs: { signature: string; err: any; logs: string[] }, programLabel: string) {
    if (logs.err) return;
    this.totalLogBatches++;

    // KEY PERFORMANCE FIX: Only proceed if the log explicitly mentions initialization.
    // Raydium v4: "InitializeInstruction2" (or sometimes "initialize2")
    // Raydium CPMM: "initialize_cpmm"
    // Pump.fun PumpSwap AMM: "CreatePool" (which lowercases to "createpool")
    const logString = logs.logs.join(' ').toLowerCase();
    const isInit = logString.includes('initializeinstruction2') || 
                   logString.includes('initialize2') || 
                   logString.includes('initialize_cpmm') || 
                   logString.includes('createpool') ||
                   logString.includes('create_pool');

    if (!isInit) return;

    if (!this.processedSignatures.has(logs.signature)) {
      logger.info(`[PoolWatcher] Candidate found via WSS logs (${programLabel}): ${logs.signature.slice(0, 8)}...`);
      this.processSignature(logs.signature, programLabel).catch(() => {});
    }
  }

  private async pollNow() {
    for (const prog of PROGRAMS_TO_WATCH) {
      await this.pollProgram(prog.id, prog.label);
    }
  }

  private async pollProgram(programId: PublicKey, label: string) {
    try {
      const sigs = await solanaConnection.connection.getSignaturesForAddress(
        programId,
        { limit: 10 },
        'confirmed'
      );

      if (!sigs || sigs.length === 0) return;
      const lastSeen = this.lastSignatures.get(label);

      if (!lastSeen) {
        this.lastSignatures.set(label, sigs[0].signature);
        return;
      }

      const lastSeenIdx = sigs.findIndex(s => s.signature === lastSeen);
      const newSigs = lastSeenIdx === -1 ? sigs : sigs.slice(0, lastSeenIdx);

      this.lastSignatures.set(label, sigs[0].signature);

      for (const sig of newSigs.filter(s => !s.err)) {
        // Polling is a bit more expensive as we don't have logs, 
        // so we only process if we haven't seen it.
        if (!this.processedSignatures.has(sig.signature)) {
          await this.processSignature(sig.signature, label);
        }
      }
    } catch (err) {
      logger.warn(`[PoolWatcher] Poll error for ${label}: ${String(err)}`);
    }
  }

  private async processSignature(signature: string, sourceLabel: string) {
    if (this.processedSignatures.has(signature)) return;
    this.processedSignatures.add(signature);

    try {
      const tx = await solanaConnection.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || !tx.transaction?.message) return;
      await this.extractPoolFromTransaction(tx, signature, sourceLabel);
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes('429')) {
        logger.warn(`[PoolWatcher] Rate limit (429) hit. Skipping TX ${signature.slice(0, 8)}...`);
      }
    }
  }

  private async extractPoolFromTransaction(
    tx: VersionedTransactionResponse,
    signature: string,
    sourceLabel: string
  ): Promise<void> {
    const message = tx.transaction.message;
    const accountKeys = message.getAccountKeys();
    const allAccounts: string[] = accountKeys.staticAccountKeys.map(k => k.toBase58());
    const lookupAccounts = accountKeys.accountKeysFromLookups;
    if (lookupAccounts) {
      lookupAccounts.writable.forEach(k => allAccounts.push(k.toBase58()));
      lookupAccounts.readonly.forEach(k => allAccounts.push(k.toBase58()));
    }

    const wsolStr = WSOL_MINT.toBase58();
    const usdcStr = USDC_MINT.toBase58();

    const candidates: Array<{ poolAddress: string; tokenMint: string; quoteMint: string; baseVault: string; quoteVault: string }> = [];

    // Helper to safely extract candidate
    const addCandidate = (amm: string, coin: string, bv: string, qv: string, quoteMint: string) => {
      if (SYSTEM_PROGRAMS.has(amm) || SYSTEM_PROGRAMS.has(coin)) return;
      if (coin.startsWith('jitodont') || amm.startsWith('jitodont')) return;
      if (coin.startsWith('Sysvar') || amm.startsWith('Sysvar')) return;
      if (coin === wsolStr || coin === usdcStr) return;
      candidates.push({ poolAddress: amm, tokenMint: coin, quoteMint, baseVault: bv, quoteVault: qv });
    };

    // Helper to parse instruction accounts
    const parseInstruction = (programId: string, accountIndexes: number[]) => {
      if (programId === RAYDIUM_V4_PROGRAM_ID.toBase58() && accountIndexes.length >= 12) {
        // Raydium v4 Initialize2: 4=amm, 8=coinMint, 9=pcMint, 10=coinVault, 11=pcVault
        const coinMint = allAccounts[accountIndexes[8]];
        const pcMint = allAccounts[accountIndexes[9]];
        const amm = allAccounts[accountIndexes[4]];
        
        if (pcMint === wsolStr || pcMint === usdcStr) {
          addCandidate(amm, coinMint, allAccounts[accountIndexes[10]], allAccounts[accountIndexes[11]], pcMint);
        } else if (coinMint === wsolStr || coinMint === usdcStr) {
          addCandidate(amm, pcMint, allAccounts[accountIndexes[11]], allAccounts[accountIndexes[10]], coinMint);
        }
      } 
      else if (programId === RAYDIUM_CPMM_PROGRAM_ID.toBase58() && accountIndexes.length >= 15) {
        // CPMM Initialize: 3=pool, 11=token0Mint, 12=token1Mint, 13=token0Vault, 14=token1Vault
        const pool = allAccounts[accountIndexes[3]];
        const token0 = allAccounts[accountIndexes[11]];
        const token1 = allAccounts[accountIndexes[12]];
        
        if (token1 === wsolStr || token1 === usdcStr) {
          addCandidate(pool, token0, allAccounts[accountIndexes[13]], allAccounts[accountIndexes[14]], token1);
        } else if (token0 === wsolStr || token0 === usdcStr) {
          addCandidate(pool, token1, allAccounts[accountIndexes[14]], allAccounts[accountIndexes[13]], token0);
        }
      }
      else if (programId === PUMP_FUN_AMM_PROGRAM_ID.toBase58() && accountIndexes.length >= 5) {
        // PumpSwap CreatePool (native Pump.fun DEX): 
        // Index 1 and 2 swap between being the pool address and the global config (ADyA...)
        // Index 3 is always the tokenMint, Index 4 is always wsolMint
        const acc1 = allAccounts[accountIndexes[1]];
        const acc2 = allAccounts[accountIndexes[2]];
        const PUMPSWAP_CONFIG = 'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw';
        const pool = acc1 === PUMPSWAP_CONFIG ? acc2 : acc1;
        
        const tokenMint = allAccounts[accountIndexes[3]];
        const quoteMint = allAccounts[accountIndexes[4]];
        
        // FIXME: Pump.fun uses bonding curves, not standard SPL token vaults.
        // We cannot blindly pass tokenMint as baseVault. MarketDataService will fail to decode balances.
        // Temporarily skipping Pump.fun pool creation until bonding curve parsing is supported.
        /*
        if (quoteMint === wsolStr || quoteMint === usdcStr) {
          addCandidate(pool, tokenMint, tokenMint, quoteMint);
        } else if (tokenMint === wsolStr || tokenMint === usdcStr) {
          addCandidate(pool, quoteMint, quoteMint, tokenMint);
        }
        */
      }
    };

    // 1. Check top-level compiled instructions
    for (const ix of message.compiledInstructions) {
      const programId = allAccounts[ix.programIdIndex];
      parseInstruction(programId, ix.accountKeyIndexes);
    }

    // 2. Check inner instructions (crucial for Pump.fun migrations creating Raydium v4 pools via CPI)
    if (tx.meta?.innerInstructions) {
      for (const inner of tx.meta.innerInstructions) {
        for (const ix of inner.instructions) {
          // If transaction is version 0, ix might be a MessageCompiledInstruction
          // Handle both parsed and raw inner instructions
          const programIdIdx = (ix as any).programIdIndex;
          if (programIdIdx !== undefined) {
            const programId = allAccounts[programIdIdx];
            const accIndexes = (ix as any).accounts || (ix as any).accountKeyIndexes || [];
            parseInstruction(programId, accIndexes);
          }
        }
      }
    }

    // 3. Process extracted candidates
    if (candidates.length === 0) {
      logger.info(`[PoolWatcher] TX ${signature.slice(0, 8)} (${sourceLabel}): No valid pool candidates extracted (heuristic mismatch)`);
    }

    for (const candidate of candidates) {
      if (this.watchedPools.has(candidate.poolAddress)) {
        logger.debug(`[PoolWatcher] Pool ${candidate.poolAddress.slice(0, 8)} already watched, skipping`);
        continue;
      }

      this.watchedPools.add(candidate.poolAddress);
      this.detectedCount++;

      const poolInfo: PoolInfo = {
        poolAddress: candidate.poolAddress,
        tokenMint: candidate.tokenMint,
        quoteMint: candidate.quoteMint,
        baseVault: candidate.baseVault,
        quoteVault: candidate.quoteVault,
        createdAt: new Date(),
      };

      logger.info(`🎯 [NEW POOL] ${sourceLabel} | ${candidate.poolAddress} | token: ${candidate.tokenMint} | quote: ${candidate.quoteMint === wsolStr ? 'SOL' : 'USDC'}`);
      LocalFileLogger.log('INFO', 'PoolWatcher', 'POOL_DETECTED', `Pool #${this.detectedCount}`, { ...poolInfo, signature });

      this.emit('newPool', poolInfo);
      await Repositories.saveDetectedPool(poolInfo);
    }
  }
}
