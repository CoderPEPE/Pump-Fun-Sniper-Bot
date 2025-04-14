// This is a browser-friendly entry point with Node.js-specific modules excluded
import { PF_MINT_AUTHORITY, PF_WALLET, solTrGrpcPfMint } from "dv-sol-lib";
import { LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { sleep } from "dv-sol-lib";

// Export only browser-compatible functions
export {
  PF_MINT_AUTHORITY,
  PF_WALLET,
  solTrGrpcPfMint,
  LAMPORTS_PER_SOL,
  Connection,
  sleep
};

// Add any other browser-safe exports from your library here
export const LUT = 'AddressLookupTab1e1111111111111111111111111';

// Browser-compatible utility functions can go here
export async function getBrowserBalance(connection: Connection, publicKey: any) {
  try {
    const balance = await connection.getBalance(publicKey) / LAMPORTS_PER_SOL;
    return balance;
  } catch (error) {
    console.error("Error checking wallet balance:", error);
    throw error;
  }
} 