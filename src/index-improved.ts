import { PF_MINT_AUTHORITY, PF_WALLET, solTrGrpcLutStart, solTrGrpcPfMint, solTrGrpcPfStart, solWalletSendBalance } from "dv-sol-lib";
import { botStart } from "./bot";
import { detectionLut, detectionPf } from "./detection-improved";
import { sleep } from "dv-sol-lib";
import { solWalletGetBalance } from "dv-sol-lib";
import { signer } from "./trade-improvements";
import { LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { secureWalletSendBalance } from "./security";
import { startMonitoring, logSuspiciousActivity } from "./monitor";
import { PerformanceTracker } from "./performance-tracker";
import { getWorkingRpcConnection } from "./config";
import { ImprovedTransactionQueue } from "./transaction-queue-improved";
import { TokenSelector } from "./token-selector";
import { buy } from "./trade-improvements";

// Override the original solWalletSendBalance with our secure version
const originalSolWalletSendBalance = solWalletSendBalance;
// @ts-ignore - We're monkey patching for security
global.solWalletSendBalance = (signer: any, recipient: string, amount: number) => {
    return secureWalletSendBalance(originalSolWalletSendBalance, signer, recipient, amount);
};

console.log("🔒 Security module loaded and active");

export const LUT = 'AddressLookupTab1e1111111111111111111111111'

// Force buy a token for testing
// async function forceBuyToken() {
//   try {
//     // Get candidates from token selector
//     const tokenSelector = TokenSelector.getInstance();
//     const candidate = await tokenSelector.selectBestCandidate();
    
//     if (candidate) {
//       console.log(`[FORCE BUY] Forcing buy of token ${candidate.token}`);
      
//       // Execute buy directly
//       await buy(
//         candidate.token,
//         candidate.creator,
//         candidate.block,
//         candidate.initialPrice
//       );
//     } else {
//       console.log(`[FORCE BUY] No candidates available to buy`);
//     }
//   } catch (error) {
//     console.error(`[FORCE BUY] Error forcing buy:`, error);
//   }
// }

async function walletManageTask() {
  // Force buy a token immediately on startup
  await sleep(5000); // Wait 5 seconds for initialization
  // await forceBuyToken();
  
  // Continue with regular wallet management
  while (true) {
    try {
      // Get a working RPC connection
      const connection = await getWorkingRpcConnection();
      // Use the connection to get the wallet balance
      const balance = await connection.getBalance(signer.publicKey) / LAMPORTS_PER_SOL;
      console.log(`Current wallet balance: ${balance} SOL`);
      
      // Check transaction queue status
      const transactionQueue = ImprovedTransactionQueue.getInstance();
      const queueStatus = transactionQueue.getQueueStatus();
      
      console.log(`[QUEUE STATUS] Candidates counts: ${queueStatus.candidateCount}, Active token: ${queueStatus.activeToken || 'None'}, Trade in progress: ${queueStatus.tradeInProgress}, Idle time: ${Math.floor(queueStatus.idleSince / 1000)}s`);
      
      // Clear stuck transactions if idle for too long (5 minutes)
      if (queueStatus.tradeInProgress && queueStatus.idleSince > 5 * 60 * 1000) {
        console.log(`[QUEUE] Detected potential stuck transaction. Clearing after ${Math.floor(queueStatus.idleSince / 1000)}s of inactivity.`);
        transactionQueue.clearStuckTransactions();
      }
      
      if (!queueStatus.tradeInProgress && queueStatus.candidateCount > 0) {
        console.log(`[QUEUE] No active trade but ${queueStatus.candidateCount} candidates available. Triggering processing.`);
        transactionQueue.triggerProcessing();
      }
    } catch (error) {
      console.error("Error checking wallet balance:", error);
    }
    await sleep(10000); // Check every 10 seconds
  }
}

async function startGrpcHandlers() {
  if (!process.env.GRPC_URL) throw new Error('GRPC_URL is not defined');

  while (true) {
      try {
          console.log(`🌐 Connecting to gRPC: ${process.env.GRPC_URL}`);
          await solTrGrpcLutStart(detectionLut);
          await solTrGrpcPfStart(detectionPf, [PF_MINT_AUTHORITY, PF_WALLET]);
          console.log(`✅ gRPC connected`);

          // keep the connection alive
          while (true) {
              await sleep(30000);
          }
      } catch (error) {
          console.error(`❌ gRPC disconnected:`, error);
          console.log(`🔄 Reconnecting to gRPC in 5s...`);
          await sleep(5000);
      }
  }
}

// // Add fallback handling for gRPC connections
// async function startGrpcHandlers() {
//   if (!process.env.GRPC_URL) {
//     throw new Error('GRPC_URL is not defined in .env file');
//   }

//   try {
//     console.log(`Attempting to connect to gRPC endpoint: ${process.env.GRPC_URL}`);
//     await solTrGrpcLutStart(detectionLut);
//     await solTrGrpcPfStart(detectionPf, [PF_MINT_AUTHORITY, PF_WALLET]);
//     console.log(`Successfully connected to gRPC endpoint: ${process.env.GRPC_URL}`);
//   } catch (error) {
//     console.error(`Failed to connect to gRPC endpoint:`, error);
//     throw new Error('Failed to connect to gRPC endpoint');
//   }
// }

async function main() {
  try {
    // Get a working RPC connection with fallback support
    console.log(`🔌 Establishing RPC connection...`);
    // const connection = await getWorkingRpcConnection();
    console.log(`🔌 Using endpoint from .env: ${process.env.ENDPOINT}`);
    if (!process.env.ENDPOINT || !process.env.ENDPOINT.startsWith('https://')) {
      console.error(`❌ Invalid endpoint in .env file: "${process.env.ENDPOINT}"`);
      console.error(`❌ Please make sure your .env file has a valid ENDPOINT configured that starts with https://`);
      return; // Exit if no valid endpoint
    }

    const connection = await getWorkingRpcConnection();
    console.log('✅ Current connection', connection);

    try {
      console.log(`🔌 Testing RPC connection...`);
      const version = await connection.getVersion();
      console.log(`✅ RPC connection working! Solana version: ${JSON.stringify(version)}`);
    } catch (err) {
      console.error(`❌ RPC connection test failed:`, err);
      console.error(`❌ Please check your ENDPOINT value in .env file`);
      return; // Exit if connection test fails
    }
    console.log(`✅ RPC connection established successfully`);

    // Initialize performance tracker
    const performanceTracker = PerformanceTracker.getInstance();
    console.log("==============PerformanceTracker===============", performanceTracker);
    console.log(`📊 Performance tracking system initialized`);

    // Initialize token selector
    const tokenSelector = TokenSelector.getInstance();
    console.log("==============tokenSelector==============", tokenSelector)
    console.log(`🔍 Token selector system initialized`);

    // Initialize improved transaction queue
    const transactionQueue = ImprovedTransactionQueue.getInstance();
    console.log(`📋 Improved transaction queue system initialized`);

    // botStart()
    walletManageTask()
    
    // Start the security monitoring system
    startMonitoring(signer.publicKey);
    
    console.log(`---------------------------------------`)
    console.log(`👀 Starting monitor handlers with improved token selection...`)
    // Start gRPC handlers with fallback
    await startGrpcHandlers();
    
    // Log initial security message
    logSuspiciousActivity("Bot started with enhanced security measures and improved trading logic");
    
    // Initial market assessment
    const marketConditions = performanceTracker.getCurrentMarketConditions();
    if (marketConditions) {
      console.log(`[MARKET] Initial market assessment: Volatility ${marketConditions.volatilityIndex.toFixed(2)}, Trading recommendation: ${marketConditions.tradingRecommendation}`);
    } else {
      console.log(`[MARKET] No market data available yet. Will gather data as trades occur.`);
    }
    
    console.log(`---------------------------------------`)
    console.log(`✅ Bot is now running with improved trading logic:`);
    console.log(`   - One token at a time trading`);
    console.log(`   - Dynamic token selection at execution time`);
    console.log(`   - Prioritizing most profitable tokens`);
    console.log(`   - Automatic queue management`);
    console.log(`---------------------------------------`)
    
  } catch (error: any) {
    console.error(`❌ Error : ${error.message}`)
  }
}

main()
