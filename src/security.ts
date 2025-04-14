import { PublicKey, Transaction } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as readline from 'readline';
import { config } from "./config";
import * as fs from 'fs';

// Load blacklist addresses from blacklist.json
let blacklistedAddresses: string[] = [];
try {
    const blacklistData = fs.readFileSync('blacklist.json', 'utf8');
    blacklistedAddresses = JSON.parse(blacklistData);
    console.log(`Loaded ${blacklistedAddresses.length} addresses from blacklist.json`);
} catch (error) {
    console.error('Error loading blacklist.json:', error);
}

// Create readline interface for user confirmation
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Known safe addresses (add your trusted addresses here)
const SAFE_ADDRESSES: string[] = [
    // Add your trusted addresses here
];

/**
 * Security wrapper for transaction verification
 * @param transaction The transaction to verify
 * @param sender The sender's public key
 * @param recipient The recipient's public key
 * @param amount The amount in SOL
 * @returns Promise<boolean> Whether the transaction is approved
 */
export async function verifyTransaction(
    transaction: Transaction,
    sender: PublicKey,
    recipient: string,
    amount: number
): Promise<boolean> {
    // Always require confirmation for large transfers
    if (amount > 1) { // Threshold of 1 SOL
        return new Promise<boolean>((resolve) => {
            console.log("\n⚠️ SECURITY ALERT ⚠️");
            console.log(`Transaction Details:`);
            console.log(`- From: ${sender.toString()}`);
            console.log(`- To: ${recipient}`);
            console.log(`- Amount: ${amount} SOL`);
            
            // Check if recipient is in blacklist
            const isBlacklisted = blacklistedAddresses.includes(recipient);
            if (isBlacklisted) {
                console.log("❌ WARNING: Recipient address is BLACKLISTED!");
            }
            
            console.log("⚠️ Always verify recipient addresses carefully");
            
            // Check if recipient is in safe addresses
            const isSafe = SAFE_ADDRESSES.includes(recipient);
            if (isSafe) {
                console.log("✅ Recipient is in your safe address list");
            }
            
            rl.question('Do you want to approve this transaction? (yes/no): ', (answer) => {
                const approved = answer.toLowerCase() === 'yes';
                if (approved) {
                    console.log("Transaction approved by user.");
                } else {
                    console.log("Transaction rejected by user.");
                }
                resolve(approved);
            });
        });
    }
    
    // For smaller amounts, check against blacklist
    if (blacklistedAddresses.includes(recipient)) {
        console.log(`❌ Transaction blocked: Recipient ${recipient} is blacklisted`);
        return false;
    }
    
    return true;
}

/**
 * Wrapper for solWalletSendBalance to add security checks
 */
export async function secureWalletSendBalance(
    originalSendFunction: Function,
    signer: any,
    recipient: string,
    amount: number
): Promise<string | undefined> {
    // Convert lamports to SOL for display
    const amountInSol = amount / LAMPORTS_PER_SOL;
    
    // Create a dummy transaction for verification
    const dummyTx = new Transaction();
    
    // Verify the transaction
    const approved = await verifyTransaction(
        dummyTx,
        signer.publicKey,
        recipient,
        amountInSol
    );
    
    if (approved) {
        try {
            // Execute the original function if approved
            return await originalSendFunction(signer, recipient, amount);
        } catch (error) {
            console.error("Error sending funds:", error);
            return undefined;
        }
    } else {
        console.log("Transaction cancelled due to security checks");
        return undefined;
    }
}

/**
 * Close readline interface when application exits
 */
export function closeSecurityModule() {
    rl.close();
}

// Add event listener for application exit
process.on('exit', () => {
    closeSecurityModule();
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log("\nShutting down security module...");
    closeSecurityModule();
    process.exit(0);
});
