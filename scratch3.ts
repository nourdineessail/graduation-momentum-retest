import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Antigravity projects V2/graduation momentum retest/.env' });
async function main() {
  const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const tx = await conn.getTransaction('KSoZjADvxafCdAtmYafYuVH2xSZ6M2xovPb43AyMViLMshzpKpQBeHFFAc3F7iCERwmoydX66JGyTdC148GxouT', { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  const msg = tx!.transaction.message;
  const accounts = msg.getAccountKeys().staticAccountKeys.map(k => k.toBase58());
  const lookups = msg.getAccountKeys().accountKeysFromLookups;
  if (lookups) {
    lookups.writable.forEach(k => accounts.push(k.toBase58()));
    lookups.readonly.forEach(k => accounts.push(k.toBase58()));
  }
  if (tx!.meta?.innerInstructions) {
    for (const inner of tx!.meta.innerInstructions) {
      for (const ix of inner.instructions) {
        const progIdx = (ix as any).programIdIndex;
        const prog = accounts[progIdx];
        if (prog === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') {
           console.log('PumpSwap Inner IX!');
           const accIndexes = (ix as any).accounts || [];
           console.log('Accounts:', accIndexes.map((idx: number) => accounts[idx]));
        }
      }
    }
  }
}
main().catch(console.error);
