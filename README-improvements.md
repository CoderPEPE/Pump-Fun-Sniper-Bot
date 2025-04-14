# Trading Bot Improvements

This document outlines the improvements needed to address the issues reported with the trading bot.

## Overview of Issues

1. **Account Wipe Issue**: The bot starts new trades before completing existing ones, leading to account depletion.
2. **Coin Search Logic**: The process of how the bot searches for coins isn't entirely clear.
3. **Stop Loss Functionality**: The stop-loss mechanism might not be triggering as expected during volatile market conditions.
4. **Rate Limit Error**: Despite having API keys in the .env file, still receiving rate limit errors.
5. **Fees and Costs**: The combined cost of priority fees, Chito fees, and slippage is eating into profits.

## Implementation Guide

The file `src/trade-improvements.ts` contains code snippets that address these issues. Follow these steps to implement the improvements:

### 1. Transaction Queue System

This improvement ensures one transaction completes before starting another, preventing account wipes.

1. Add the `TransactionQueue` class from `trade-improvements.ts` to `src/trade.ts`
2. Modify the `buy` function in `src/trade.ts` to use the queue:

```typescript
// At the top of trade.ts
import { TransactionQueue } from './transaction-queue'; // If you move it to a separate file

// In the detection.ts file, replace direct calls to buy with:
export function detectionPf(data: any) {
  // ...existing code...
  
  // Replace direct buy calls with:
  const queue = TransactionQueue.getInstance();
  queue.queueBuy(token, creator, block, initialPrice);
  
  // ...rest of the function...
}

// In the buy function, add at the end:
export async function buy(token: string, creator: string, mintBlock?: number, initialPrice?: number): Promise<void> {
  // ...existing buy code...
  
  // Replace the direct call to sell with:
  const queue = TransactionQueue.getInstance();
  queue.queueSell(creator, token, tx, mintBlock, cumulativeAmount, boughtPrice);
}
```

### 2. Transparent Token Scoring System

This improvement makes the coin search logic more transparent.

1. Add the `TokenScorer` class from `trade-improvements.ts` to `src/detection.ts`
2. Modify the token detection logic in `handlePfMint` function:

```typescript
function handlePfMint(data: any) {
  // ...existing code...
  
  // Replace the complex conditional logic with:
  if (TokenScorer.shouldTrade(data.token, data.creator, data.initialBuy)) {
    startRateLimitedTrade(data.token, data.creator, data.block, data.initialPrice);
  } else {
    console.log(`[SCORE] Skipping trade for ${data.token} based on scoring system`);
  }
}
```

### 3. Enhanced Stop Loss System

This improvement makes the stop loss more reliable in volatile conditions.

1. Replace the `isNeedToSell` function in `src/trade.ts` with the improved version from `trade-improvements.ts`
2. Fix the TypeScript error with the static variable by adding this at the top of the function:

```typescript
// At the top of the file, outside any function
const lastPriceMap: Record<string, {price: number, timestamp: number}> = {};

// Then in the isNeedToSell function, replace:
static let lastPrice: Record<string, {price: number, timestamp: number}> = {};

// With:
if (!lastPriceMap[token]) {
  lastPriceMap[token] = {price: curPrice, timestamp: Date.now()};
} else {
  // ...rest of the code using lastPriceMap instead of lastPrice
}
```

### 4. Enhanced Rate Limiting

This improvement reduces rate limit errors.

1. Add the `EnhancedRateLimiter` class from `trade-improvements.ts` to `src/config.ts`
2. Replace the existing `RateLimiter` usage with the enhanced version:

```typescript
// In config.ts
export const enhancedRateLimiter = EnhancedRateLimiter.getInstance();

// Replace all instances of rateLimiter.throttle() with:
await enhancedRateLimiter.throttle(endpoint);

// Replace all instances of rateLimiter.recordError() with:
enhancedRateLimiter.recordError(endpoint, isRateLimitError);

// Replace all instances of rateLimiter.recordSuccess() with:
enhancedRateLimiter.recordSuccess(endpoint);
```

### 5. Fee Optimization

This improvement reduces the impact of fees on profitability.

1. Update `config.json` with the reduced fee values:

```json
{
  "slippage": 10,           // Reduced from 100 to 10
  "prioityFee": 5,          // Reduced from 10 to 5
  "jitoBuyTip": 0.002,      // Reduced from 0.005 to 0.002
  "jitoSellTip": 0.001,     // Reduced from 0.003 to 0.001
  "minProfitThreshold": 5,  // New parameter: minimum profit threshold in %
  "maxFeePercentage": 3     // New parameter: maximum fee percentage of trade amount
}
```

2. Add the fee calculation and profitability check functions from `trade-improvements.ts` to `src/trade.ts`

3. Add the profitability check to the `buy` function in `src/trade.ts`:

```typescript
export async function buy(token: string, creator: string, mintBlock?: number, initialPrice?: number): Promise<void> {
  // ...existing code...
  
  // Add this before executing the buy transaction:
  if (!isProfitableTrade(token, boughtPrice || initialPrice || 0, config.amountTrade)) {
    console.log(`[${token}] Skipping trade due to low profitability after fees`);
    return;
  }
  
  // ...rest of the function...
}
```

## Additional Recommendations for Devnet Testing

Since you're running on devnet, here are some additional recommendations:

1. **Reduce Trade Amount**: Set a smaller `amountTrade` value in config.json for testing (e.g., 0.05 SOL instead of 0.2 SOL)

2. **Add Devnet-Specific Configuration**:
```json
{
  "devnetMode": true,
  "devnetSlippage": 5,      // Lower slippage for devnet
  "devnetPriorityFee": 2,   // Lower priority fee for devnet
  "devnetJitoBuyTip": 0.001 // Lower jito tip for devnet
}
```

3. **Add Devnet Detection in Code**:
```typescript
// In trade.ts
const useDevnetParams = config.devnetMode === true;
const slippage = useDevnetParams ? config.devnetSlippage : config.slippage;
const priorityFee = useDevnetParams ? config.devnetPriorityFee : config.prioityFee;
const jitoTip = useDevnetParams ? config.devnetJitoBuyTip : config.jitoBuyTip;
```

4. **Increase Logging for Devnet**:
```typescript
// Add this to the top of key functions
if (config.devnetMode) {
  console.log(`[DEVNET] Function called with params:`, { token, creator, initialPrice });
}
```

## Implementation Strategy

1. Start by implementing the Transaction Queue system to prevent account wipes
2. Next, implement the Enhanced Rate Limiting to reduce API errors
3. Then implement the Fee Optimization to improve profitability
4. Follow with the Stop Loss improvements
5. Finally, implement the Token Scoring system

This order prioritizes the most critical issues first while minimizing the risk of introducing new bugs.
