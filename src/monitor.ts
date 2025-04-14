import { PublicKey } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { solWalletGetBalance } from "dv-sol-lib";
import { sleep } from "dv-sol-lib";
import * as fs from 'fs';
import * as path from 'path';
import { getWorkingRpcConnection } from "./config";

// Suspicious address that was found in the code
const SUSPICIOUS_ADDRESS = "Cg79FXC9pNkMjNJuJjehwuCRSW5quC9idEUKuVurMtUJ";

// Transaction history log file
const TRANSACTION_LOG_FILE = path.join(process.cwd(), 'transaction-history.json');

interface BalanceRecord {
    timestamp: string;
    balance: number;
    change?: number;
    previousBalance?: number;
}

interface TransactionHistory {
    records: BalanceRecord[];
    suspiciousActivities: string[];
}

// Initialize transaction history
let transactionHistory: TransactionHistory = {
    records: [],
    suspiciousActivities: []
};

// Load existing transaction history if available
try {
    if (fs.existsSync(TRANSACTION_LOG_FILE)) {
        const data = fs.readFileSync(TRANSACTION_LOG_FILE, 'utf8');
        transactionHistory = JSON.parse(data);
        console.log(`Loaded transaction history with ${transactionHistory.records.length} records`);
    }
} catch (error) {
    console.error('Error loading transaction history:', error);
}

/**
 * Save transaction history to file
 */
function saveTransactionHistory() {
    try {
        fs.writeFileSync(TRANSACTION_LOG_FILE, JSON.stringify(transactionHistory, null, 2));
    } catch (error) {
        console.error('Error saving transaction history:', error);
    }
}

/**
 * Log a suspicious activity
 * @param message The suspicious activity message
 */
export function logSuspiciousActivity(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    
    console.log(`⚠️ SUSPICIOUS ACTIVITY: ${message}`);
    transactionHistory.suspiciousActivities.push(logEntry);
    saveTransactionHistory();
}

/**
 * Monitor wallet balance for suspicious changes
 * @param walletPublicKey The wallet public key to monitor
 */
export async function monitorWalletBalance(walletPublicKey: PublicKey) {
    let previousBalance: number | null = null;
    
    console.log(`🔍 Starting wallet balance monitor for ${walletPublicKey.toString()}`);
    
    while (true) {
        try {
            // Get a working RPC connection with fallback support
            const connection = await getWorkingRpcConnection();
            
            // Get current balance using the connection
            const balanceInLamports = await connection.getBalance(walletPublicKey);
            const currentBalance = balanceInLamports / LAMPORTS_PER_SOL;
            const timestamp = new Date().toISOString();
            
            // If we have a previous balance, check for suspicious changes
            if (previousBalance !== null) {
                const change = currentBalance - previousBalance;
                
                // Record the balance change
                const record: BalanceRecord = {
                    timestamp,
                    balance: currentBalance,
                    change,
                    previousBalance
                };
                
                transactionHistory.records.push(record);
                
                // Check for suspicious large decreases in balance
                // Increased threshold from 1 to 2 SOL to reduce false alerts
                if (change < -2 && Math.abs(change) > 2) {
                    logSuspiciousActivity(`Large balance decrease detected: ${change.toFixed(4)} SOL`);
                }
                
                // Save transaction history periodically
                if (transactionHistory.records.length % 10 === 0) {
                    saveTransactionHistory();
                }
            } else {
                // First record
                transactionHistory.records.push({
                    timestamp,
                    balance: currentBalance
                });
            }
            
            previousBalance = currentBalance;
        } catch (error) {
            console.error('Error monitoring wallet balance:', error);
        }
        
        // Wait before checking again
        await sleep(60000); // Check every 60 seconds instead of 30 to reduce API requests
    }
}

/**
 * Start the monitoring system
 * @param walletPublicKey The wallet public key to monitor
 */
export function startMonitoring(walletPublicKey: PublicKey) {
    // Start wallet balance monitoring
    monitorWalletBalance(walletPublicKey);
    
    console.log('👁️ Monitoring system started');
}
