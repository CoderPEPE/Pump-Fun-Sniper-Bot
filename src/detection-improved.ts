import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58'
import { addLutTemporary, buyingTokenAdd, buyingTokenFind, buyingTokenIncreaseBuyCount, isCreateTokenExceeds, temporayLUT, WhitelistAdd, WhitelistExist, WhitelistRemove } from './whitelist';
import { PF_CMD_BUY, PF_CMD_SELL, PF_FEE_RECIPIENT, PF_MINT_AUTHORITY, PF_PROGRAM_ID, pfGetTokenDataByApi, reportDetectionTime, solTrIsPumpfunBuy } from 'dv-sol-lib';
import { config, getWorkingRpcConnection, rateLimiter } from './config';
import { bytesToUInt64, getCurrentTimestamp, sleep } from 'dv-sol-lib';
import { solBlockTimeGet } from 'dv-sol-lib';
import { confirmedConnection } from 'dv-sol-lib';
import * as net from "net"
import { server } from 'typescript';
import { PerformanceTracker } from './performance-tracker';
import { ImprovedTransactionQueue } from './transaction-queue-improved';
import { TokenCandidate } from './token-selector';
import { TokenSelector } from './token-selector';

// Initialize performance tracker
const performanceTracker = PerformanceTracker.getInstance();

// Initialize improved transaction queue
const transactionQueue = ImprovedTransactionQueue.getInstance();

export let buyCountsInMintBlock: any = {}
export const buyingAssets: any = {}
export const tradingTokens: any = {}

function toBuffer(data: any) {
  if (typeof data === 'string')
    return Buffer.from(data, 'base64')
  return data
}

function bytesToInt(bytes: number[]): number {
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
}

export function getCumulative(token: string) {
  return tradingTokens[token]
}

export function IsExceedsCumulative(token: string) {
  if (!config.maxSolAmountBeforBuy || !tradingTokens[token])
    return false

  console.log(`[LOG] cumulative sol :`, tradingTokens[token])
  if (tradingTokens[token] > config.maxSolAmountBeforBuy) {
    console.log(`[LOG] cumulative sol exceeds :`, tradingTokens[token])
    return true
  }
  return false
}

async function getBuyCountInBlock(mintBlock: number, token: string): Promise<number> {
  let buyCount = 0
  let blockResp
  let retryCount = 0
  const MAX_RETRIES = 5
  
  console.time('check-count')
  
  while (retryCount < MAX_RETRIES) {
    try {
      // Get a working RPC connection with fallback support
      const connection = await getWorkingRpcConnection();
      
      // Use the connection to get the block
      blockResp = await connection.getBlock(mintBlock, { maxSupportedTransactionVersion: 0 });
      break;
    } catch (error) {
      retryCount++;
      console.error(`[RPC] Error getting block ${mintBlock}, retry ${retryCount}/${MAX_RETRIES}: ${error}`);
      
      if (retryCount >= MAX_RETRIES) {
        console.error(`[RPC] Failed to get block ${mintBlock} after ${MAX_RETRIES} retries`);
        return 0; // Return 0 if we can't get the block after max retries
      }
      
      // Exponential backoff
      const delay = Math.min(5000, 500 * Math.pow(2, retryCount));
      console.log(`[RPC] Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }
  
  if (!blockResp) {
    console.error(`[RPC] Failed to get block ${mintBlock}`);
    return 0;
  }
  
  const transactions = blockResp.transactions;
  if (!transactions) {
    console.error(`[RPC] No transactions found in block ${mintBlock}`);
    return 0;
  }
  
  transactions.forEach((tr: any) => {
    if (solTrIsPumpfunBuy(tr, token)) {
      console.log(`[LOG] pumpfun buy : sig = ${tr.transaction.signatures[0]}`);
      buyCount++;
    }
  });
  
  console.timeEnd('check-count');
  
  if (buyCount) {
    buyCountsInMintBlock[token] = buyCount;
  }
  
  return buyCount;
}

export function detectionLut(data: any) {
  if (!data.signer)
    return
  WhitelistAdd(data.signer, data.addresses, data.slot)
}

/**
 * Evaluate a token for potential trading
 * Instead of immediately buying, add it to the candidate pool
 */
function evaluateTokenForTrading(data: any) {
  reportDetectionTime(`${data.token}`, data.block, undefined, `(initialBuy = ${data.initialBuy})`);
  
  // Get token selector instance
  const tokenSelector = TokenSelector.getInstance();
  
  // Check whitelist if not in devnetMode
  const creatorInWhitelist = config.devnetMode ? true : WhitelistExist(data.creator);
  const creatorIsGoodMaker = config.goodMakers.includes(data.creator);
  
  // Log decision factors
  console.log(`[EVAL] Token ${data.token} - Creator in whitelist: ${creatorInWhitelist}, Creator is good maker: ${creatorIsGoodMaker}`);
  
  // Always add to candidate pool for evaluation
  const candidate = {
    token: data.token,
    creator: data.creator,
    initialPrice: data.initialPrice,
    detectedAt: getCurrentTimestamp(),
    block: data.block,
    initialBuy: data.initialBuy
  };
  
  // Add to token selector instead of transaction queue
  tokenSelector.addCandidate(candidate);
  
  console.log(`[LOG] ************* CANDIDATE (TOKEN: ${data.token}, creator: ${data.creator}, initialPrice: ${data.initialPrice})`);
  console.log(`[SELECTOR] Current candidate pool size: ${tokenSelector.getCandidateCount()}`);
}

function handlePfTrade(data: any) {
  // Track trading volume for market analysis
  if (!tradingTokens[data.token]) {
    tradingTokens[data.token] = 0;
  }
  tradingTokens[data.token] += data.solAmount;
  
  // Log significant trades for analysis
  if (data.solAmount > 1.0) {
    console.log(`[MARKET] Significant trade detected for ${data.token}: ${data.solAmount.toFixed(3)} SOL`);
  }
}

export function detectionPf(data: any) {
  const MAX_RETRIES = 3;
  let retryCount = 0;

  const attemptDetection = async () => {
    try {
      switch (data.type) {
        case 'Mint':
          if (config.devnetMode) {
            console.log(`[DEVNET TEST] Evaluating token ${data.token}`);
            const candidate: TokenCandidate = {
              token: data.token,
              creator: data.creator,
              initialPrice: data.initialPrice,
              detectedAt: getCurrentTimestamp(),
              block: data.block,
              initialBuy: data.initialBuy
            };
            transactionQueue.addTokenCandidate(candidate);
          } else {
            evaluateTokenForTrading(data);
          }
          break;
        case 'Trade':
          handlePfTrade(data);
          break;
      }
    } catch (error) {
      console.error(`Detection error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        await sleep(1000 * retryCount);
        return attemptDetection();
      }
      throw error;
    }
  };

  return attemptDetection();
}
