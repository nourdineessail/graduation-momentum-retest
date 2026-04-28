import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Antigravity projects V2/graduation momentum retest/.env' });
async function main() {
  const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const tx = await conn.getTransaction('26vEsXM5tYWoSNMpqR9mHJaRy9sk2y2hmQ3fUb5QfSjYQMYkYajMhbZhKTyBcEqySLGm8iiUcVmBjNaPgGqtPJDL', { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  console.log(tx!.meta?.logMessages);
}
main().catch(console.error);
