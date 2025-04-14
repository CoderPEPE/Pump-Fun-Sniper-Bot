import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { solWalletImport } from 'dv-sol-lib';
import { createLedgerSigner, LedgerWallet } from './ledger-integration';
import * as fs from 'fs';
import * as readline from 'readline';

// Interface for wallet signer
export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
}

// Wallet types
export enum WalletType {
  PRIVATE_KEY = 'private_key',
  LEDGER = 'ledger'
}

// Wallet configuration
interface WalletConfig {
  type: WalletType;
}

// Default config path
const CONFIG_PATH = './wallet-config.json';

/**
 * Get the current wallet configuration
 */
function getWalletConfig(): WalletConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(configData);
    }
  } catch (error) {
    console.error('Error reading wallet config:', error);
  }
  
  // Default to private key if no config exists
  return { type: WalletType.PRIVATE_KEY };
}

/**
 * Save wallet configuration
 */
function saveWalletConfig(config: WalletConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('Wallet configuration saved.');
  } catch (error) {
    console.error('Error saving wallet config:', error);
  }
}

/**
 * Get the appropriate wallet signer based on configuration
 */
export async function getWalletSigner(): Promise<WalletSigner> {
  const config = getWalletConfig();
  
  switch (config.type) {
    case WalletType.LEDGER:
      console.log('Using Ledger hardware wallet...');
      return await createLedgerSigner();
      
    case WalletType.PRIVATE_KEY:
    default:
      console.log('Using private key from .env file...');
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('PRIVATE_KEY not found in .env file');
      }
      const keypair = solWalletImport(privateKey)!;
      
      // Create a signer that matches our WalletSigner interface
      return {
        publicKey: keypair.publicKey,
        signTransaction: async (transaction: Transaction) => {
          transaction.partialSign(keypair);
          return transaction;
        }
      };
  }
}

/**
 * Interactive function to switch wallet type
 */
export async function switchWalletType(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    console.log('\n=== Wallet Type Selection ===');
    console.log('1. Private Key (from .env file)');
    console.log('2. Ledger Hardware Wallet');
    
    rl.question('Select wallet type (1-2): ', async (answer) => {
      let newType: WalletType;
      
      switch (answer.trim()) {
        case '2':
          newType = WalletType.LEDGER;
          console.log('\nSwitching to Ledger hardware wallet...');
          
          // Test Ledger connection
          try {
            console.log('Testing Ledger connection...');
            const ledgerWallet = await LedgerWallet.getInstance();
            const publicKey = ledgerWallet.getPublicKeySync();
            console.log(`Successfully connected to Ledger with public key: ${publicKey.toString()}`);
          } catch (error) {
            console.error('Failed to connect to Ledger:', error);
            console.log('Please make sure your Ledger is connected and the Solana app is open.');
            rl.close();
            resolve();
            return;
          }
          break;
          
        case '1':
        default:
          newType = WalletType.PRIVATE_KEY;
          console.log('\nSwitching to private key from .env file...');
          break;
      }
      
      // Save the new configuration
      saveWalletConfig({ type: newType });
      
      console.log(`Wallet type switched to: ${newType}`);
      rl.close();
      resolve();
    });
  });
}

// If this file is run directly, execute the switch function
if (require.main === module) {
  switchWalletType().then(() => {
    process.exit(0);
  });
}
