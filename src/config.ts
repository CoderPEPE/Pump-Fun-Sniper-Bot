import { sleep } from "dv-sol-lib"
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { Connection } from '@solana/web3.js';
import { AdvancedRateLimiter } from './rate-limiter';

export const rateLimiter = AdvancedRateLimiter.getInstance();

export const FALLBACK_RPC_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana.api.rpcpool.com",
  "https://solana-mainnet.g.alchemy.com/v2/demo",
  "https://rpc.ankr.com/solana",
  "https://mainnet.helius-rpc.com/?api-key=15319106-8b8b-4c6b-8547-979e354dd0ee",
  "https://solana-api.tt-prod.net",
  "https://api.mainnet.rpcpool.com",
  "https://api.metaplex.solana.com",
  "https://ssc-dao.genesysgo.net",
  "https://free.rpcpool.com"
];

let currentEndpointIndex = 0;

export function getNextEndpoint(): string {
  const endpoint = FALLBACK_RPC_ENDPOINTS[currentEndpointIndex];
  currentEndpointIndex = (currentEndpointIndex + 1) % FALLBACK_RPC_ENDPOINTS.length;
  return endpoint;
}

const RPC_ENDPOINTS = [
  "https://fragrant-shy-mansion.solana-mainnet.quiknode.pro/8adcdcdffceeca3330fa483e8ec167773afd46d1",
  process.env.ENDPOINT 
];

async function measureLatency(endpoint: string): Promise<number> {
  const start = Date.now();
  try {
      const connection = new Connection(endpoint, "confirmed");
      await connection.getEpochInfo(); 
      return Date.now() - start;
  } catch {
      return Number.MAX_SAFE_INTEGER; 
  }
}

export async function getWorkingRpcConnection(): Promise<Connection> {
  const latencies: { endpoint: string; latency: number }[] = [];

  for (const url of RPC_ENDPOINTS) {
      if (!url) continue;
      const latency = await measureLatency(url);
      latencies.push({ endpoint: url, latency });
  }

  latencies.sort((a, b) => a.latency - b.latency);

  const best = latencies[0];

  if (best.latency === Number.MAX_SAFE_INTEGER) {
      throw new Error("No working RPC endpoint found");
  }

  console.log(`✅ Selected RPC: ${best.endpoint} (latency: ${best.latency}ms)`);
  return new Connection(best.endpoint, "confirmed");
}


// Function to get a working RPC connection
// export async function getWorkingRpcConnection(): Promise<Connection> {
//   // Create connection with increased timeout and commitment
//   const createConnection = (endpoint: string) => {
//     return new Connection(endpoint, {
//       commitment: 'confirmed',
//       confirmTransactionInitialTimeout: 60000, // 60 seconds
//       disableRetryOnRateLimit: false
//     });
//   };
  
//   // Try to connect with retries
//   const tryConnect = async (endpoint: string, retries = 3): Promise<Connection | null> => {
//     for (let i = 0; i < retries; i++) {
//       try {
//         // Apply rate limiting before making the request
//         await rateLimiter.throttle();
        
//         const connection = createConnection(endpoint);
//         await connection.getVersion();
        
//         // Record successful request
//         rateLimiter.recordSuccess();
        
//         return connection;
//       } catch (error: any) {
//         const isRateLimitError = error?.message?.includes('429') || 
//                                 error?.message?.includes('Too many requests') ||
//                                 error?.message?.includes('rate limit');
        
//         // Record error for rate limiting
//         rateLimiter.recordError(isRateLimitError);
        
//         console.error(`[RPC] Connection attempt ${i+1}/${retries} to ${endpoint} failed: ${error?.message || 'Unknown error'}`);
        
//         if (i < retries - 1) {
//           // Wait before retrying (exponential backoff)
//           const delay = isRateLimitError 
//             ? Math.min(30000, 5000 * Math.pow(2, i)) // Longer delay for rate limit errors
//             : Math.min(5000, 1000 * Math.pow(2, i));  // Standard delay for other errors
            
//           console.log(`[RPC] Waiting ${delay}ms before retry...`);
//           await sleep(delay);
//         }
//       }
//     }
//     return null;
//   };
  
//   // Try endpoints in rotation to distribute load
//   // Start with the configured endpoint from .env if available
//   const configuredEndpoint = process.env.ENDPOINT;
//   if (configuredEndpoint) {
//     console.log(`[RPC] Trying configured endpoint: ${configuredEndpoint}`);
//     const connection = await tryConnect(configuredEndpoint);
//     if (connection) {
//       console.log(`[RPC] Using configured endpoint: ${configuredEndpoint}`);
//       return connection;
//     }
//   }
  
//   // Try up to 5 different endpoints from our rotation
//   const maxAttempts = 5;
//   for (let i = 0; i < maxAttempts; i++) {
//     const endpoint = getNextEndpoint();
//     console.log(`[RPC] Trying endpoint ${i+1}/${maxAttempts}: ${endpoint}`);
    
//     const connection = await tryConnect(endpoint);
//     if (connection) {
//       console.log(`[RPC] Using endpoint: ${endpoint}`);
//       return connection;
//     }
    
//     // Add a delay before trying the next endpoint
//     await sleep(1000);
//   }
  
//   // If all endpoints fail, return a connection with the first endpoint
//   // This is a last resort and will likely fail, but at least we tried
//   console.error(`[RPC] All endpoints failed, using first endpoint as last resort`);
//   return createConnection(FALLBACK_RPC_ENDPOINTS[0]);
// }

// Event emitter for config changes
export const configEvents = new EventEmitter();

export interface Config {
  enabled: boolean,
  devnetMode?: boolean,
  amountTrade: number,
  slippage: number,
  tp: number,
  sl: number,
  activityTimeout: number,
  profitTimeout: number,
  cumulativeSol: number,
  minLUTCount: number,
  prioityFee: number,
  retryCount: number,
  jitoBuyTip: number,
  jitoSellTip: number,
  devBuyMin: number,
  devBuyMax: number,
  maxBuyInSlot: number,
  maxSolAmountBeforBuy: number,
  cumulativeBlacklist: number[],
  initialBuyBlackList: number[],
  initialBuyWhiteList: number[],
  maxTxCountInMintBlock: number,
  tickerBlacklist: string[],
  NumberAllow: boolean,
  whitelist: string[],
  goodMakers: string[],
  dynamicStopLoss?: boolean,
  dynamicTakeProfit?: boolean,
  maxVolatilityForTrading?: number,
  adaptiveFees?: boolean,
  maxConcurrentTrades?: number,
  rateLimitDelay?: number,
  minProfitThreshold?: number,
  maxFeePercentage?: number,
  devnetSlippage?: number,
  devnetPriorityFee?: number,
  devnetJitoBuyTip?: number,
  maxBalancePercentage?: number,
  tradeCooldownPeriod?: number,
  randomDelayMin?: number,
  randomDelayMax?: number
}

export let config: Config;
let originalConfig: Config; 


async function loadConfig() {
  while (true) {
    try {
      const fdata = fs.readFileSync('config.json', 'utf8');
      const newConfig = JSON.parse(fdata);
      
      if (!originalConfig) {
        originalConfig = { ...newConfig };
      }
      
      const hasChanges = JSON.stringify(config) !== JSON.stringify(newConfig);
      
      config = newConfig;
      
      if (config.dynamicStopLoss === undefined) config.dynamicStopLoss = true;
      if (config.dynamicTakeProfit === undefined) config.dynamicTakeProfit = true;
      if (config.maxVolatilityForTrading === undefined) config.maxVolatilityForTrading = 80;
      if (config.adaptiveFees === undefined) config.adaptiveFees = true;
      
      if (config.maxConcurrentTrades === undefined) config.maxConcurrentTrades = 2;
      if (config.rateLimitDelay === undefined) config.rateLimitDelay = 3000;
      
      if (config.maxBalancePercentage === undefined) config.maxBalancePercentage = 20;
      
      if (config.tradeCooldownPeriod === undefined) config.tradeCooldownPeriod = 300000; // 5 minutes
      if (config.randomDelayMin === undefined) config.randomDelayMin = 5000; // 5 seconds
      if (config.randomDelayMax === undefined) config.randomDelayMax = 15000; // 15 seconds
      
      if (hasChanges) {
        console.log('[CONFIG] Configuration updated from file');
        configEvents.emit('configUpdated', config);
      }
      
      await sleep(5000);
    } catch (error) {
      console.error('[CONFIG] Error loading config:', error);
      await sleep(5000);
    }
  }
}

export function updateDynamicConfig(updates: Partial<Config>): void {
  Object.assign(config, updates);
  
  console.log('[CONFIG] Dynamic configuration updated:', updates);
  
  configEvents.emit('configUpdated', config);
}

export function resetDynamicConfig(): void {
  if (originalConfig) {
    config.slippage = originalConfig.slippage;
    config.tp = originalConfig.tp;
    config.sl = originalConfig.sl;
    config.prioityFee = originalConfig.prioityFee;
    config.jitoBuyTip = originalConfig.jitoBuyTip;
    config.jitoSellTip = originalConfig.jitoSellTip;
    
    console.log('[CONFIG] Dynamic parameters reset to original values');
    configEvents.emit('configUpdated', config);
  }
}

loadConfig();
