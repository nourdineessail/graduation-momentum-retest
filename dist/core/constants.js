"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEX_FEE_PERCENT = exports.USDC_MINT = exports.WSOL_MINT = exports.PUMP_FUN_MIGRATION_PROGRAM_ID = exports.PUMP_FUN_AMM_PROGRAM_ID = exports.RAYDIUM_CPMM_PROGRAM_ID = exports.RAYDIUM_V4_PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
// ─── AMM Programs ─────────────────────────────────────────────────────────────
/** Raydium AMM v4 — legacy, still active for old pool swaps */
exports.RAYDIUM_V4_PROGRAM_ID = new web3_js_1.PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
/**
 * Raydium CPMM — Constant Product Market Maker (newer Raydium pools)
 * Some tokens still graduate here.
 */
exports.RAYDIUM_CPMM_PROGRAM_ID = new web3_js_1.PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
/**
 * Pump.fun AMM — introduced early 2025. Pump.fun graduation tokens
 * now primarily flow here instead of Raydium AMM v4.
 */
exports.PUMP_FUN_AMM_PROGRAM_ID = new web3_js_1.PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
/**
 * Pump.fun migration program — the outer wrapper that triggers
 * graduation from Pump.fun bonding curve into an AMM.
 * Subscribing here catches ALL graduation events regardless of target AMM.
 */
exports.PUMP_FUN_MIGRATION_PROGRAM_ID = new web3_js_1.PublicKey('39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg');
// ─── Token Mints ──────────────────────────────────────────────────────────────
exports.WSOL_MINT = new web3_js_1.PublicKey('So11111111111111111111111111111111111111112');
exports.USDC_MINT = new web3_js_1.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
// ─── Fees ─────────────────────────────────────────────────────────────────────
exports.DEX_FEE_PERCENT = 0.25; // 0.25% Raydium/Pump.fun fee
