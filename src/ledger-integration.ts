import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { config } from './config';
import { verifyTransaction } from './security';

// This class handles Ledger integration for the trading bot
export class LedgerWallet {
  private static instance: LedgerWallet;
  private publicKey: PublicKey | null = null;
  private derivationPath = "44'/501'/0'/0'"; // Standard Solana derivation path
  private transport: any = null;

  private constructor() {}

  // Singleton pattern to ensure only one instance
  public static async getInstance(): Promise<LedgerWallet> {
    if (!LedgerWallet.instance) {
      LedgerWallet.instance = new LedgerWallet();
      await LedgerWallet.instance.connect();
    }
    return LedgerWallet.instance;
  }

  // Connect to Ledger device
  private async connect() {
    try {
      console.log('Attempting to connect to Ledger device...');
      this.transport = await TransportNodeHid.create();
      console.log('Connected to Ledger device');
      
      // Get public key from Ledger
      const { publicKey } = await this.getPublicKey();
      this.publicKey = new PublicKey(publicKey);
      console.log(`Ledger wallet public key: ${this.publicKey.toString()}`);
    } catch (error) {
      console.error('Failed to connect to Ledger:', error);
      throw new Error('Could not connect to Ledger. Please make sure it is connected and the Solana app is open.');
    }
  }

  // Get public key from Ledger
  private async getPublicKey() {
    const solana = new (require('@ledgerhq/hw-app-solana')).default(this.transport);
    return await solana.getAddress(this.derivationPath);
  }

  // Get the wallet's public key
  public getPublicKeySync(): PublicKey {
    if (!this.publicKey) {
      throw new Error('Ledger not connected or public key not retrieved');
    }
    return this.publicKey;
  }

  // Sign a transaction using the Ledger
  public async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this.transport) {
      throw new Error('Ledger not connected');
    }

    try {
      // First, use our security module to verify the transaction
      const recipient = transaction.instructions[0].keys[1].pubkey.toString();
      const amount = transaction.instructions[0].data.readUInt32LE(0) / 1000000000; // Convert lamports to SOL
      
      // Verify transaction using our security module
      const approved = await verifyTransaction(
        transaction,
        this.publicKey!,
        recipient,
        amount
      );

      if (!approved) {
        throw new Error('Transaction rejected by security verification');
      }

      // Prepare the transaction for Ledger signing
      const solana = new (require('@ledgerhq/hw-app-solana')).default(this.transport);
      
      // Serialize the transaction
      const message = transaction.serializeMessage();
      
      // Sign the transaction with Ledger (this will prompt the user on the device)
      console.log('Please approve the transaction on your Ledger device...');
      const { signature } = await solana.signTransaction(this.derivationPath, message);
      
      // Add the signature to the transaction
      transaction.addSignature(this.publicKey!, Buffer.from(signature));
      
      return transaction;
    } catch (error) {
      console.error('Error signing transaction with Ledger:', error);
      throw new Error('Failed to sign transaction with Ledger');
    }
  }

  // Close the connection to the Ledger
  public async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      console.log('Disconnected from Ledger device');
    }
  }
}

// Helper function to create a Ledger signer that mimics the interface of the current signer
export async function createLedgerSigner() {
  const ledgerWallet = await LedgerWallet.getInstance();
  
  return {
    publicKey: ledgerWallet.getPublicKeySync(),
    signTransaction: async (transaction: Transaction) => {
      return await ledgerWallet.signTransaction(transaction);
    }
  };
}
