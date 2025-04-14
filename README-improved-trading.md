# Enhanced Trading Strategy: One Token at a Time

This update improves the trading bot's strategy by ensuring it buys only one token at a time and dynamically selects the most profitable token at execution time, rather than relying on a static queue.

## Key Improvements

### 1. One Token at a Time Trading
- The bot now trades only one token at a time, ensuring full focus on each trade
- After selling the current token, it dynamically selects the next most profitable token to buy
- This prevents the bot from depleting the account balance on multiple simultaneous trades

### 2. Dynamic Token Selection
- Instead of immediately queuing tokens for purchase, the bot adds them to a candidate pool
- At execution time, it evaluates all candidates to select the most profitable one
- This ensures the bot always trades the token with the highest profit potential at the moment of execution

### 3. Scoring System
- Each token candidate is scored based on multiple factors:
  - Expected profitability after fees
  - Creator's historical performance
  - Token age (newer tokens get higher priority)
  - Market conditions

### 4. Improved Queue Management
- The new transaction queue system manages the entire trading lifecycle
- Automatically detects and clears stuck transactions
- Periodically re-evaluates the candidate pool to select the best token

## New Components

### 1. TokenSelector
The `TokenSelector` class manages a pool of token candidates and provides methods to:
- Add new candidates to the pool
- Calculate profitability and scores for each candidate
- Select the best candidate for trading
- Clean up expired candidates

### 2. ImprovedTransactionQueue
The `ImprovedTransactionQueue` class replaces the original queue with a smarter system that:
- Manages the entire trading lifecycle
- Ensures only one token is traded at a time
- Dynamically selects the best token at execution time
- Detects and clears stuck transactions

### 3. Detection Improvements
The detection system has been updated to:
- Add tokens to the candidate pool instead of immediately queuing them
- Apply initial filtering to avoid adding unprofitable tokens
- Track token metadata for better decision making

## How to Use

1. Run the improved version of the bot:
```bash
npx ts-node src/index-improved.ts
```

2. Monitor the logs to see:
- Token candidates being added to the pool
- Scoring and selection of the best token
- One-at-a-time trading in action

## Configuration

The existing configuration parameters in `config.json` still apply, with some having enhanced effects:

- `maxConcurrentTrades`: Now effectively limited to 1
- `tradeCooldownPeriod`: Enforced between trades
- `maxBalancePercentage`: Strictly enforced to limit trading to a percentage of wallet balance

## Benefits

1. **Reduced Risk**: By trading one token at a time, the bot spreads risk over time rather than simultaneously
2. **Better Timing**: Dynamic selection ensures the bot trades the most profitable token at execution time
3. **Improved Capital Efficiency**: The bot won't deplete the account balance on multiple simultaneous trades
4. **Smarter Decision Making**: The scoring system considers multiple factors to select the best token

## Technical Implementation

The implementation consists of three main files:
- `src/token-selector.ts`: Manages the candidate pool and selection logic
- `src/transaction-queue-improved.ts`: Handles the trading lifecycle
- `src/detection-improved.ts`: Updates the detection system to work with the new approach

These components work together to create a more intelligent and efficient trading system that maximizes profitability while minimizing risk.
