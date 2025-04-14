import { config, getWorkingRpcConnection } from "./config";
import dotenv from "dotenv"
import {
  solWalletImport,
  pfGetTokenDataByApi,
  solPFBuy,
  solPFFetchPrice,
  solPFSell,
  solTokenBalance,
  solTokenGetMeta,
  getCurrentTimestamp,
  solBlockTimeGet,
  sleep,
  solTrGetBalanceChange,
  solTrGetTimestamp,
  RENT,
  SOL_ACCOUNT_RENT_FEE
} from "dv-sol-lib";
import { buyingAssets, getCumulative, IsExceedsCumulative, tradingTokens } from "./detection-improved";
import { buyingTokenFind, WhitelistRemove } from "./whitelist";
import path from "path";
import { blackListAdd } from "./blacklist";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PerformanceTracker } from "./performance-tracker";
import { ImprovedTransactionQueue } from "./transaction-queue-improved";
import { rateLimiter } from "./config";
import { PumpFunSDK } from "./sdk";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";

dotenv.config()
export const signer = solWalletImport(process.env.PRIVATE_KEY!)!

// Initialize transaction queue
const transactionQueue = ImprovedTransactionQueue.getInstance();

// Last price tracking for rapid decline detection
const lastPriceMap: Record<string, { price: number, timestamp: number }> = {};

// Track last trade time to enforce cooldown period
let lastTradeTime = 0;

// Track total balance used for trading to enforce maxBalancePercentage
let totalBalanceUsed = 0;
let lastBalanceCheck = 0;
const BALANCE_CHECK_INTERVAL = 60000; // 1 minute
let cachedWalletBalance = 0;

// Mock trading for devnet testing
const MOCK_TRADING = config.devnetMode === true && process.env.ENDPOINT?.includes('devnet');

async function mockBuyTransaction(token: string, amount: number): Promise<string> {
  console.log(`[MOCK] Simulating buy of ${token} for ${amount} SOL`);
  await sleep(2000); // Simulate transaction time
  return `mock-tx-${Date.now()}`; // Return a mock transaction hash
}

async function mockSellTransaction(token: string, amount: number): Promise<string> {
  console.log(`[MOCK] Simulating sell of ${token}`);
  await sleep(2000); // Simulate transaction time
  return `mock-tx-${Date.now()}`; // Return a mock transaction hash
}

/**
 * Get the current wallet balance in SOL
 */
async function getWalletBalance(): Promise<number> {
  try {
    // Get a connection to the Solana network
    const connection = await getWorkingRpcConnection();

    // Get the balance of the wallet
    const balance = await connection.getBalance(signer.publicKey);

    // Convert from lamports to SOL
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(`[BALANCE] Error getting wallet balance:`, error);
    return cachedWalletBalance || 0; // Return cached balance or 0 if no cache
  }
}

/**
 * Calculate estimated fees for a trade
 */
function calculateEstimatedFees(tradeAmount: number, priorityFee: number, jitoTip: number, slippage: number): number {
  // Base transaction fee (0.000005 SOL)
  const baseFee = 0.000005;

  // Priority fee
  const estimatedPriorityFee = priorityFee * 0.000001 * 1500; // Approximate for 1500 compute units

  // Jito tip
  const estimatedJitoTip = jitoTip;

  // Slippage cost (approximate)
  const estimatedSlippage = (tradeAmount * slippage) / 100;

  // Total estimated fees
  const totalFees = baseFee + estimatedPriorityFee + estimatedJitoTip + estimatedSlippage;

  return totalFees;
}

/**
 * Check if a trade is likely to be profitable after fees
 */
function isProfitableTrade(token: string, initialPrice: number, tradeAmount: number): boolean {
  // Get take profit (no longer using dynamic take profit)
  const takeProfit = config.tp;

  // Calculate expected profit at take profit target
  const expectedProfit = (tradeAmount * takeProfit) / 100;

  // Calculate estimated fees for buy and sell
  const buyFees = calculateEstimatedFees(
    tradeAmount,
    config.prioityFee,
    config.jitoBuyTip,
    config.slippage
  );

  const sellFees = calculateEstimatedFees(
    tradeAmount * (1 + takeProfit / 100),
    config.prioityFee,
    config.jitoSellTip,
    config.slippage
  );

  // Total fees
  const totalFees = buyFees + sellFees;

  // Check if expected profit exceeds fees by a margin
  const minProfitThreshold = config.minProfitThreshold || 1; // Default 1%
  const profitAfterFees = expectedProfit - totalFees;

  // Log profitability analysis
  console.log(`[PROFIT] ${token} profitability analysis:`);
  console.log(`[PROFIT] Expected profit at ${takeProfit}% take profit: ${expectedProfit.toFixed(6)} SOL`);
  console.log(`[PROFIT] Estimated fees: Buy ${buyFees.toFixed(6)} + Sell ${sellFees.toFixed(6)} = ${totalFees.toFixed(6)} SOL`);
  console.log(`[PROFIT] Profit after fees: ${profitAfterFees.toFixed(6)} SOL`);
  console.log(`[PROFIT] Required profit (${minProfitThreshold}%): ${(tradeAmount * minProfitThreshold / 100).toFixed(6)} SOL`);

  // Only trade if profit after fees is positive
  return profitAfterFees > 0;
}

/**
 * Check if we should enforce a cooldown period between trades
 */
function shouldEnforceCooldown(): boolean {
  if (!config.tradeCooldownPeriod) {
    return false;
  }

  const now = getCurrentTimestamp();
  const timeSinceLastTrade = now - lastTradeTime;

  if (timeSinceLastTrade < config.tradeCooldownPeriod) {
    console.log(`[COOLDOWN] Trade cooldown period in effect. ${((config.tradeCooldownPeriod - timeSinceLastTrade) / 1000).toFixed(1)}s remaining.`);
    return true;
  }

  return false;
}

/**
 * Check if we've used too much of our balance for trading
 */
async function shouldLimitBalanceUsage(tradeAmount: number): Promise<boolean> {
  if (!config.maxBalancePercentage) {
    return false;
  }

  const now = getCurrentTimestamp();

  // Only check balance periodically to avoid too many RPC calls
  if (now - lastBalanceCheck > BALANCE_CHECK_INTERVAL) {
    try {
      // Get current wallet balance
      const balanceInSol = await getWalletBalance();

      // Cache the balance
      cachedWalletBalance = balanceInSol;

      // Reset the tracking
      totalBalanceUsed = 0;
      lastBalanceCheck = now;

      console.log(`[BALANCE] Current wallet balance: ${balanceInSol.toFixed(6)} SOL`);
    } catch (error) {
      console.error(`[BALANCE] Error checking wallet balance:`, error);
    }
  }

  // Calculate max amount we can use
  const maxBalanceToUse = (config.maxBalancePercentage / 100) * cachedWalletBalance;

  // Check if this trade would exceed our limit
  if (totalBalanceUsed + tradeAmount > maxBalanceToUse) {
    console.log(`[BALANCE] Trade would exceed max balance usage. Current: ${totalBalanceUsed.toFixed(6)} SOL, Max: ${maxBalanceToUse.toFixed(6)} SOL`);
    return true;
  }

  return false;
}

async function reportBlockNumber(txHash: string, startBlock: number) {
  const trTime = await solTrGetTimestamp(txHash, true)
  if (trTime) {
    console.log(`[LOG] :::::::::::::: bought after ${trTime.blockNumber - startBlock} blocks`)
  }
}

async function getTokenBalance(token: string): Promise<number> {
  while (true) {
    try {
      const [rawBalance, _] = await solTokenBalance(token, signer.publicKey, 30)
      return Number(rawBalance)
    } catch (error) {
      await sleep(500)
    }
  }
}

// Initialize performance tracker
const performanceTracker = PerformanceTracker.getInstance();

// Maximum number of retries for failed transactions
const MAX_TRANSACTION_RETRIES = 3;

/***************** BUY *********************/
// buy condition
// 1. check blacklist
export async function buy(token: string, creator: string, mintBlock?: number, initialPrice?: number): Promise<void> {
  let retryCnt = 0
  let tx: string | undefined
  let boughtPrice = 0
  let cumulativeAmount = 0
  const startTime = getCurrentTimestamp();

  if (config.enabled === false) {
    console.error(`Trade is disabled! Skip without buying ...`)
    return
  }

  // Check if we should enforce cooldown period
  if (shouldEnforceCooldown()) {
    console.log(`[${token}] Skipping trade due to cooldown period`);
    return;
  }

  // Check if we should limit balance usage
  if (await shouldLimitBalanceUsage(config.amountTrade)) {
    console.log(`[${token}] Skipping trade due to balance usage limits`);
    return;
  }

  // Get token metadata with retries
  if (config.tickerBlacklist && config.tickerBlacklist.length) {
    let tokenMeta: any = undefined
    let metaRetries = 0;
    const MAX_META_RETRIES = 5;

    while (!tokenMeta && metaRetries < MAX_META_RETRIES) {
      try {
        tokenMeta = await pfGetTokenDataByApi(token);
        if (!tokenMeta) {
          metaRetries++;
          const delay = Math.min(3000, 500 * Math.pow(2, metaRetries));
          console.log(`[${token}] Failed to get token metadata, retry ${metaRetries}/${MAX_META_RETRIES} - waiting ${delay}ms`);
          await sleep(delay);
          continue;
        }

        console.log(`[LOG] token meta (name:${tokenMeta.name}, symbol: ${tokenMeta.symbol})`);

        // Check blacklist
        if (config.tickerBlacklist.some((b: string) => tokenMeta.name?.includes(b) || tokenMeta.symbol?.includes(b))) {
          console.log(`[LOG](trade) Ticker(${tokenMeta.name} | ${tokenMeta.symbol}) is in blacklist! skip to buy ...`);
          return;
        }

        // Check for numbers
        if (!config.NumberAllow) {
          const containsNumbers = /\d/.test(tokenMeta.name) || /\d/.test(tokenMeta.symbol);
          if (containsNumbers) {
            console.log(`[LOG](trade) Tokens of which ticker | name contain number is not allowed ...`);
            return;
          }
        }
      } catch (error) {
        metaRetries++;
        console.error(`[${token}] Error getting token metadata:`, error);
        const delay = Math.min(3000, 500 * Math.pow(2, metaRetries));
        await sleep(delay);
      }
    }

    if (!tokenMeta && metaRetries >= MAX_META_RETRIES) {
      console.log(`[${token}] Failed to get token metadata after ${MAX_META_RETRIES} retries, proceeding anyway...`);
    }
  }

  // Check cumulative limit
  if (IsExceedsCumulative(token)) {
    console.log(`[LOG](${token}) Bought amount exceeds limit, skip to buy ...`);
    return;
  }
  cumulativeAmount = getCumulative(token);

  // Try to get initial price with retries
  let priceRetries = 0;
  const MAX_PRICE_RETRIES = 5;
  let curPrice = 0;

  while (priceRetries < MAX_PRICE_RETRIES) {
    try {
      curPrice = await solPFFetchPrice(token) || initialPrice || 0;
      if (curPrice) break;

      priceRetries++;
      const delay = Math.min(3000, 500 * Math.pow(2, priceRetries));
      console.log(`[${token}] Failed to get price, retry ${priceRetries}/${MAX_PRICE_RETRIES} - waiting ${delay}ms`);
      await sleep(delay);
    } catch (error) {
      priceRetries++;
      console.error(`[${token}] Error getting price:`, error);
      const delay = Math.min(3000, 500 * Math.pow(2, priceRetries));
      await sleep(delay);
    }
  }

  console.log(`[${token}] ::: buying... initial price = ${curPrice}`);

  // Calculate profitability and only proceed if profitable
  console.log(`[${token}] Checking profitability with price ${curPrice} and amount ${config.amountTrade}...`);
  const isProfitable = isProfitableTrade(token, curPrice, config.amountTrade);
  if (!isProfitable) {
    console.log(`[${token}] Skipping trade due to negative profitability`);
    return;
  }
  console.log(`[${token}] Proceeding with trade - profitability check passed`);
  console.log(`[${token}] Starting buy transaction process...`);

  // Buy transaction with retries
  while ((!tx || tx === '' || tx === 'fetch error') && retryCnt < config.retryCount) {
    if (retryCnt) {
      // Use exponential backoff for retries to avoid rate limits
      const backoffDelay = Math.min(5000, 500 * Math.pow(2, retryCnt));
      console.log(`[RATE LIMIT] Retry ${retryCnt}/${config.retryCount} for ${token} - waiting ${backoffDelay}ms`);
      await sleep(backoffDelay);
    }

    try {
      // Apply rate limiting
      await rateLimiter.throttle('buy_transaction');

      // Use fixed priority fee instead of dynamic
      const priorityFee = config.prioityFee;

      // Increase priority fee and slippage with each retry
      const retryMultiplier = 1 + (retryCnt * 0.1); // Increase by 10% each retry
      const adjustedPriorityFee = priorityFee * retryMultiplier;
      const adjustedJitoTip = config.jitoBuyTip * retryMultiplier;
      const adjustedSlippage = config.slippage * (1 + (retryCnt * 0.05)); // Increase slippage by 5% each retry

      // Use devnet parameters if in devnet mode
      const useDevnetParams = config.devnetMode === true && process.env.ENDPOINT?.includes('devnet');
      const finalSlippage = useDevnetParams ? (config.devnetSlippage || 5) : adjustedSlippage;
      const finalPriorityFee = useDevnetParams ? (config.devnetPriorityFee || 2) : adjustedPriorityFee;
      const finalJitoTip = useDevnetParams ? (config.devnetJitoBuyTip || 0.001) : adjustedJitoTip;

      console.log(`[${token}] Buying with priorityFee=${finalPriorityFee}, jitoTip=${finalJitoTip}, slippage=${finalSlippage}%`);

      // Use mock trading for devnet if enabled
      if (MOCK_TRADING) {
        console.log(`[DEVNET] Using mock trading for ${token}`);
        tx = await mockBuyTransaction(token, config.amountTrade);
      } else {
        // Real transaction
        // tx = await solPFBuy(
        //   signer, 
        //   token, 
        //   config.amountTrade, 
        //   finalSlippage, 
        //   finalPriorityFee, 
        //   finalJitoTip, 
        //   curPrice, 
        //   config
        // );
        // let connection = new Connection("https://rpc.shyft.to?api_key=5Yb3Rph9WlPEUt9a");
        let connection = await getWorkingRpcConnection();
        let wallet = new NodeWallet(signer); //note this is not used
        const provider = new AnchorProvider(connection, wallet, {
          commitment: "confirmed",
        });

        let sdk = new PumpFunSDK(provider);

        console.log("Buying token: ", token);
        console.log({
          signer: signer.publicKey.toBase58(),
          token: token,
          amount: BigInt(config.amountTrade * LAMPORTS_PER_SOL),
          slippage: BigInt(Math.round(finalSlippage * 100)),
          unitLimit: 500000,
          unitPrice: 500000,
        })

        let boundingCurveAccount = await sdk.getBondingCurveAccount(new PublicKey(token));
        while (!boundingCurveAccount) {
          console.log("Bounding Curve Account: ", boundingCurveAccount);
          await sleep(100);
          boundingCurveAccount = await sdk.getBondingCurveAccount(new PublicKey(token));
        }
        console.log("Bounding Curve Account: ", boundingCurveAccount);

        let buyResults = await sdk.buy(
          signer,
          new PublicKey(token),
          // BigInt(10000000),
          BigInt(Math.floor(config.amountTrade * LAMPORTS_PER_SOL)),
          // BigInt(900),
          BigInt(Math.round(finalSlippage * 100)),
          {
            unitLimit: 500000,
            unitPrice: 500000,
          },
        );

        console.log("Buy results: ", buyResults);
        tx = buyResults?.signature;
      }

      if (tx && tx !== 'fetch error' && tx !== '') {
        console.log(`Buy transaction successful: ${tx}`);
        boughtPrice = curPrice;

        // Update last trade time and balance used
        lastTradeTime = getCurrentTimestamp();
        totalBalanceUsed += config.amountTrade;

        break;
      } else {
        console.log(`Buy transaction failed with result: ${tx}`);
      }
    } catch (error) {
      console.error(`[${token}] Buy transaction failed with error:`, error);
      if (error instanceof Error) {
        console.error(`[${token}] Error details: ${error.message}`);
        console.error(`[${token}] Stack trace: ${error.stack}`);
      }
      // Log all parameters
      console.error(`[${token}] Transaction parameters:`, {
        token,
        amount: config.amountTrade * LAMPORTS_PER_SOL,
        slippage: config.slippage * 100,
        walletBalance: await getWalletBalance()
      });
    }
    retryCnt++;
  }

  if (tx === 'fetch error' || !tx) {
    console.log(`[LOG](${token}) Failed to buy after ${retryCnt} retries! tx = ${tx}`);
    return;
  }

  if (mintBlock) {
    reportBlockNumber(tx, mintBlock);
  }

  WhitelistRemove(creator);

  // Add a delay before starting the sell process to avoid rate limits
  await sleep(2000);

  // Start the sell process
  console.log(`[${token}] Starting sell process after successful buy`);
  sell(creator, token, tx, mintBlock, cumulativeAmount, boughtPrice);
}

/***************** SELL *********************/
// sell condition
// 1. meet profit
// 2. timeout
// 3. stop loss`

async function isNeedToSell(
  token: string,
  boughtPrice: number,
  percent: number,
  timeElapsed: number,
  mintBlock: number | undefined,
  cumulative: number | undefined,
  activityStart: number,
  curPrice: number): Promise<boolean> {

  // Use fixed take profit and stop loss values
  const takeProfit = config.tp;
  const stopLoss = config.sl;

  // Calculate profit/loss percentage
  const tp = percent - 100
  if (tp >= takeProfit) {
    console.log(`[${token}] Profit target met! (${tp.toFixed(2)}% > ${takeProfit.toFixed(2)}%)`)
    return true
  }

  const sl = 100 - percent
  if (sl > stopLoss) {
    console.log(`[${token}] Stop loss triggered! (${sl.toFixed(2)}% > ${stopLoss.toFixed(2)}%)`)
    return true
  }

  // Time-based exit - reduced from 60 to 30 seconds
  if (timeElapsed > config.profitTimeout) {
    console.log(`[${token}] Time elapsed! (${timeElapsed.toFixed(2)}s > ${config.profitTimeout}s)`)
    return true
  }

  if (boughtPrice > 0.00006
    && (timeElapsed > 7/* || curPrice > boughtPrice*/)) {
    console.log(`[${token}] *** SELL *** Bought Price high & time elapsed!`)
    return true
  }

  if (config.maxBuyInSlot !== undefined
    && mintBlock
    && buyingAssets[mintBlock]
    && buyingAssets[mintBlock][token]
    && buyingAssets[mintBlock][token] > config.maxBuyInSlot) {
    console.log(`[LOG](trade) Buy count in mint block exceeds limit!`)
    return true
  }

  // Reduced from 30 to 15 seconds
  const noActivityTime = (getCurrentTimestamp() - activityStart) / 1000
  if (noActivityTime > config.activityTimeout) {
    console.log(`[${token}] No activity for ${noActivityTime.toFixed(2)}s > ${config.activityTimeout}s!`)
    return true
  }

  // Force sell after 30 seconds regardless of other conditions (reduced from 60s)
  if (timeElapsed > 30) {
    console.log(`[${token}] *** FORCE SELL *** Maximum hold time reached (30s)`)
    return true
  }

  return false
}

export async function sell(creator: string, token: string, boughtTxHash: string, mintBlock?: number, cumulative?: number, _boughtPrice?: number): Promise<void> {
  console.log(`[${token}] Starting sell process for token bought with tx: ${boughtTxHash}`);

  let balance = 0
  let startTime = getCurrentTimestamp()
  let boughtPrice = _boughtPrice

  console.log(`[${token}] Getting token price...`);
  while (!boughtPrice) {
    try {
      await rateLimiter.throttle('price_fetch');
      boughtPrice = await solPFFetchPrice(token)
      if (boughtPrice) {
        console.log(`[${token}] Got token price: ${boughtPrice}`);
      } else {
        console.log(`[${token}] Failed to get token price, retrying...`);
      }
    } catch (error) {
      console.error(`[${token}] Error getting token price:`, error);
    }
    await sleep(100)
  }

  // wait for buy completion
  console.log(`[${token}] Waiting for token balance to appear...`);
  let balanceCheckCount = 0;
  let balanceCheckTimeout = 60000; // 60 seconds timeout (reduced from original)
  while (!balance && (getCurrentTimestamp() - startTime) < balanceCheckTimeout) {
    try {
      balance = await getTokenBalance(token)
      balanceCheckCount++;
      if (balanceCheckCount % 5 === 0) {
        console.log(`[${token}] Still waiting for balance... (${balanceCheckCount} checks)`);
      }
    } catch (error) {
      console.error(`[${token}] Error checking token balance:`, error);
    }
    // Increase delay between balance checks to reduce API requests
    await sleep(1000) // Reduced from 2000ms to 1000ms
  }

  if (!balance) {
    console.log(`[${token}] Buy failed! No token balance detected after ${balanceCheckTimeout / 1000} seconds.`);
    // Record failed trade in performance tracker
    performanceTracker.recordTrade(
      token,
      creator,
      boughtPrice || 0,
      0,
      0,
      startTime,
      getCurrentTimestamp(),
      false
    );
    return
  }

  console.log(`[${token}] Token balance detected: ${balance}`);

  const investAmount = (0 - await solTrGetBalanceChange(boughtTxHash, signer.publicKey.toBase58(), true)) - SOL_ACCOUNT_RENT_FEE
  console.log(`[${token}] Bought! tx =`, boughtTxHash)
  startTime = getCurrentTimestamp()
  let activityStart = startTime
  let oldPrice = 0
  let cnt = 0
  let sellTx: string | undefined
  let sellRetries = 0
  const MAX_SELL_RETRIES = 3

  // Log initial state for debugging
  console.log(`[${token}] Starting sell monitoring loop with:
    Balance: ${balance}
    Bought price: ${boughtPrice}
    Invest amount: ${investAmount}
    Start time: ${new Date(startTime).toISOString()}
    Activity start: ${new Date(activityStart).toISOString()}
    Profit timeout: ${config.profitTimeout}s
    Activity timeout: ${config.activityTimeout}s
  `);

  // Main sell monitoring loop
  while (balance) {
    try {
      await rateLimiter.throttle('price_check');
      const curPrice = await solPFFetchPrice(token)
      if (!curPrice) {
        console.log(`[${token}] Failed to get current price, retrying...`);
        await sleep(500)
        continue
      }

      const estimatingSolAmount = (curPrice * balance) / LAMPORTS_PER_SOL
      const percent = (estimatingSolAmount / investAmount) * 100
      const timeElapsed = (getCurrentTimestamp() - startTime) / 1000

      if ((++cnt % 5 === 0) || curPrice != oldPrice) {
        const curTm = getCurrentTimestamp()
        if (curPrice != oldPrice) {
          activityStart = curTm
          console.log(`[${token}] Price changed from ${oldPrice} to ${curPrice}, resetting activity timer`);
        }
        oldPrice = curPrice
        console.log(`[${token}][${curPrice}] ------ (${estimatingSolAmount.toFixed(6)}/${investAmount.toFixed(6)} [${percent.toFixed(2)} %]) (passed: ${timeElapsed.toFixed(2)} s, activity: ${((curTm - activityStart) / 1000).toFixed(2)} s)`)
      }

      // Check if we need to sell
      if (await isNeedToSell(token, boughtPrice, percent, timeElapsed, mintBlock, cumulative, activityStart, curPrice)) {
        console.log(`[${token}] Sell condition met, attempting to sell...`);

        try {
          // Apply rate limiting
          await rateLimiter.throttle('sell_transaction');

          // Use fixed priority fee
          const priorityFee = config.prioityFee;
          console.log(`[${token}] Using priority fee: ${priorityFee}`);

          // Determine appropriate jito tip based on profit situation
          const jitoTip = curPrice > boughtPrice
            ? Math.max(config.jitoSellTip, 0.0001)
            : 0.0001;
          console.log(`[${token}] Using jito tip: ${jitoTip}`);

          // Use devnet parameters if in devnet mode
          const useDevnetParams = config.devnetMode === true && process.env.ENDPOINT?.includes('devnet');
          const finalSlippage = useDevnetParams ? (config.devnetSlippage || 5) : config.slippage;
          const finalPriorityFee = useDevnetParams ? (config.devnetPriorityFee || 2) : priorityFee;
          const finalJitoTip = useDevnetParams ? (config.devnetJitoBuyTip || 0.001) : jitoTip;

          // Try to sell with fixed parameters
          console.log(`[${token}] Executing sell transaction with balance: ${balance}, slippage: ${finalSlippage}%`);

          // Use mock trading for devnet if enabled
          if (MOCK_TRADING) {
            console.log(`[DEVNET] Using mock trading for sell of ${token}`);
            sellTx = await mockSellTransaction(token, balance);
          } else {
            // Real transaction
            // sellTx = await solPFSell(
            //   signer,
            //   token,
            //   balance,
            //   finalSlippage,
            //   finalPriorityFee,
            //   finalJitoTip
            // );

            // let connection = new Connection("https://rpc.shyft.to?api_key=5Yb3Rph9WlPEUt9a");
            let connection = await getWorkingRpcConnection();
            let wallet = new NodeWallet(signer); //note this is not used
            const provider = new AnchorProvider(connection, wallet, {
              commitment: "confirmed",
            });

            let sdk = new PumpFunSDK(provider);

            const sellResult = await sdk.sell(
              signer,
              new PublicKey(token),
              BigInt(balance),
              BigInt(Math.round(finalSlippage * 100)),
              {
                unitLimit: 500000,
                unitPrice: 500000,
              },
            );

            console.log("Sell results: ", sellResult);
            sellTx = sellResult?.signature;
          }

          if (sellTx) {
            console.log(`[${token}] Sell transaction successful: ${sellTx}`);

            // Update balance used tracking
            totalBalanceUsed -= config.amountTrade;
            if (totalBalanceUsed < 0) totalBalanceUsed = 0;

            break;
          } else {
            console.log(`[${token}] Sell transaction failed, will retry with higher fees`);
          }

          // If sell fails, retry with increased priority fee and exponential backoff
          if (!sellTx && sellRetries < MAX_SELL_RETRIES) {
            // Use exponential backoff for retries
            const backoffDelay = Math.min(5000, 500 * Math.pow(2, sellRetries));
            console.log(`[RATE LIMIT] Sell retry ${sellRetries + 1}/${MAX_SELL_RETRIES} for ${token} - waiting ${backoffDelay}ms`);
            await sleep(backoffDelay);

            // Increase parameters for retry
            const increasedSlippage = config.slippage * 1.5; // Increased from 1.2 to 1.5
            const increasedPriorityFee = priorityFee * 2.0; // Increased from 1.5 to 2.0
            const increasedJitoTip = jitoTip * 2.0; // Increased from 1.5 to 2.0

            console.log(`[${token}] Retrying sell with increased parameters: slippage=${increasedSlippage}%, priorityFee=${increasedPriorityFee}, jitoTip=${increasedJitoTip}`);

            let connection = await getWorkingRpcConnection();
            let wallet = new NodeWallet(signer); //note this is not used
            const provider = new AnchorProvider(connection, wallet, {
              commitment: "confirmed",
            });

            let sdk = new PumpFunSDK(provider);

            const sellResult = await sdk.sell(
              signer,
              new PublicKey(token),
              BigInt(balance),
              BigInt(Math.round(increasedSlippage * 100)),
              {
                unitLimit: 250000,
                unitPrice: 250000,
              },
            );

            console.log("Sell results: ", sellResult);
            sellTx = sellResult?.signature;

            if (sellTx) {
              console.log(`[${token}] Retry sell transaction successful: ${sellTx}`);

              // Update balance used tracking
              totalBalanceUsed -= config.amountTrade;
              if (totalBalanceUsed < 0) totalBalanceUsed = 0;

              break;
            } else {
              console.log(`[${token}] Retry sell transaction failed`);
            }

            sellRetries++;
          }
        } catch (error) {
          console.error(`[${token}] Error during sell transaction:`, error);
        }
      }

      // Check if we still have a balance
      try {
        balance = await getTokenBalance(token);
        if (balance === 0) {
          console.log(`[${token}] Token balance is now 0, exiting sell loop`);
          break;
        }
      } catch (error) {
        console.error(`[${token}] Error checking token balance:`, error);
      }
    } catch (error) {
      console.error(`[${token}] Error in sell loop:`, error);
    }
    // Reduced delay between price checks from 2000ms to 1000ms
    await sleep(1000)
  }

  const endTime = getCurrentTimestamp();

  if (sellTx) {
    const sellAmount = await solTrGetBalanceChange(sellTx, signer.publicKey.toBase58(), true);
    const profit = sellAmount - investAmount;
    const isProfit = profit > 0;

    // Update blacklist if trade was unprofitable
    if (sellAmount < investAmount) {
      blackListAdd(creator);
    }

    console.log(`[${token}] ++++++++++++ Success to sell. profit : ${profit.toFixed(3)} sol`);

    // Record trade in performance tracker
    performanceTracker.recordTrade(
      token,
      creator,
      boughtPrice,
      oldPrice,
      profit,
      startTime,
      endTime,
      isProfit
    );
  }
}
