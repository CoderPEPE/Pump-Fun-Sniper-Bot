import { PublicKey, Transaction } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as readline from 'readline';
import { config } from "./config";
import * as fs from 'fs';

let blacklistedAddresses: string[] = [];
try {
    const blacklistData = fs.readFileSync('blacklist.json', 'utf8');
    blacklistedAddresses = JSON.parse(blacklistData);
    console.log(`Loaded ${blacklistedAddresses.length} addresses from blacklist.json`);
} catch (error) {
    console.error('Error loading blacklist.json:', error);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const SAFE_ADDRESSES: string[] = [
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
    if (amount > 1) { 
        return new Promise<boolean>((resolve) => {
            console.log("\n⚠️ SECURITY ALERT ⚠️");
            console.log(`Transaction Details:`);
            console.log(`- From: ${sender.toString()}`);
            console.log(`- To: ${recipient}`);
            console.log(`- Amount: ${amount} SOL`);
            
            const isBlacklisted = blacklistedAddresses.includes(recipient);
            if (isBlacklisted) {
                console.log("❌ WARNING: Recipient address is BLACKLISTED!");
            }
            
            console.log("⚠️ Always verify recipient addresses carefully");
            
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
    const amountInSol = amount / LAMPORTS_PER_SOL;
    
    const dummyTx = new Transaction();
    
    const approved = await verifyTransaction(
        dummyTx,
        signer.publicKey,
        recipient,
        amountInSol
    );
    
    if (approved) {
        try {
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

process.on('exit', () => {
    closeSecurityModule();
});

process.on('SIGINT', () => {
    console.log("\nShutting down security module...");
    closeSecurityModule();
    process.exit(0);
});
