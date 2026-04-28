import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Antigravity projects V2/graduation momentum retest/.env' });

async function main() {
  const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const tx = await conn.getTransaction('26vEsXM5tYWoSNMpqR9mHJaRy9sk2y2hmQ3fUb5QfSjYQMYkYajMhbZhKTyBcEqySLGm8iiUcVmBjNaPgGqtPJDL', { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  
  if (!tx || !tx.transaction.message) {
    console.log('Tx not found');
    return;
  }
  
  const msg = tx.transaction.message;
  const accounts = msg.getAccountKeys().staticAccountKeys.map(k => k.toBase58());
  const lookups = msg.getAccountKeys().accountKeysFromLookups;
  if (lookups) {
    lookups.writable.forEach(k => accounts.push(k.toBase58()));
    lookups.readonly.forEach(k => accounts.push(k.toBase58()));
  }
  
  console.log('Accounts:', accounts.length);
  
  for (const ix of msg.compiledInstructions) {
    const prog = accounts[ix.programIdIndex];
    console.log('Instruction to:', prog);
    console.log('Account Indexes:', ix.accountKeyIndexes);
    const resolvedAccounts = Array.from(ix.accountKeyIndexes).map(idx => accounts[idx]);
    console.log('Resolved:', resolvedAccounts);
  }
  
  if (tx.meta?.innerInstructions) {
    for (const inner of tx.meta.innerInstructions) {
      console.log('Inner IX for top-level index ' + inner.index + ':');
      for (const ix of inner.instructions) {
        const progIdx = (ix as any).programIdIndex;
        if (progIdx !== undefined) {
          const prog = accounts[progIdx];
          console.log('  Inner to:', prog);
          console.log('  Inner Accounts:', (ix as any).accountKeyIndexes.map(idx => accounts[idx]));
        }
      }
    }
  }
}
main().catch(console.error);
