import { EventEmitter } from 'events';
import { sleep } from "dv-sol-lib";
import { TokenSelector, TokenCandidate } from './token-selector';
import { getWorkingRpcConnection } from './config';

export class ImprovedTransactionQueue {
  private static instance: ImprovedTransactionQueue;
  private processing = false;
  private events = new EventEmitter();
  private activeTrade: string | null = null;
  private tradeInProgress = false;
  
  // Track last activity time to detect stuck transactions
  private lastActivityTime: number = Date.now();
  // Timeout for stuck transactions (5 minutes)
  private readonly STUCK_TRANSACTION_TIMEOUT = 5 * 60 * 1000;
  
  // Token selector for dynamic token selection
  private tokenSelector = TokenSelector.getInstance();
  
  private constructor() {
    // Start a timer to check for stuck transactions
    setInterval(() => this.checkForStuckTransactions(), 60000);
    
    // Start a timer to process the queue periodically - reduced from 30s to 15s
    setInterval(() => this.processQueue(), 15000);
  }
  
  public static getInstance(): ImprovedTransactionQueue {
    if (!ImprovedTransactionQueue.instance) {
      ImprovedTransactionQueue.instance = new ImprovedTransactionQueue();
    }
    return ImprovedTransactionQueue.instance;
  }
  
  /**
   * Check for stuck transactions and clear them if needed
   */
  private checkForStuckTransactions(): void {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTime;
    
    // Reduced timeout from 5 minutes to 2 minutes
    if (this.tradeInProgress && timeSinceLastActivity > 2 * 60 * 1000) {
      console.log(`[QUEUE] Detected stuck transaction. Clearing after ${timeSinceLastActivity / 1000}s of inactivity.`);
      this.clearStuckTransactions();
    }
  }
  
  /**
   * Clear any stuck transactions
   */
  public clearStuckTransactions(): void {
    if (this.activeTrade) {
      console.log(`[QUEUE] Clearing stuck transaction for ${this.activeTrade}`);
      this.activeTrade = null;
    }
    
    this.tradeInProgress = false;
    this.processing = false;
    this.lastActivityTime = Date.now();
    
    // Process the queue to select a new token
    this.processQueue();
  }
  
  /**
   * Add a token candidate to the selection pool
   */
  public addTokenCandidate(candidate: TokenCandidate): void {
    this.tokenSelector.addCandidate(candidate);
    
    // If no active trade, process the queue to potentially start a new trade
    if (!this.tradeInProgress && !this.processing) {
      // Process immediately instead of waiting for the next interval
      setTimeout(() => this.processQueue(), 1000);
    }
  }
  
  /**
   * Process the queue to select and trade the best token
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.tradeInProgress) {
      return;
    }
    
    try {
      this.processing = true;
      // Add delay between processing attempts
      await sleep(1000);
      this.lastActivityTime = Date.now();

      // Add connection check
      const connection = await getWorkingRpcConnection();
      if (!connection) {
        console.log('[QUEUE] No valid RPC connection available, skipping processing');
        return;
      }

      console.log(`[QUEUE] Processing queue to select best token candidate`);
      console.log(`[QUEUE] Current candidate count: ${this.tokenSelector.getCandidateCount()}`);
      
      // Select the best token candidate
      const bestCandidate = await this.tokenSelector.selectBestCandidate();
      
      if (!bestCandidate) {
        console.log(`[QUEUE] No suitable token candidates found`);
        return;
      }
      
      console.log(`[QUEUE] Selected best candidate: ${bestCandidate.token} with initial price ${bestCandidate.initialPrice}`);
      
      // Start trading the selected token
      this.activeTrade = bestCandidate.token;
      this.tradeInProgress = true;
      
      console.log(`[QUEUE] Starting trade for ${bestCandidate.token}`);
      
      // Execute the buy function
      try {
        // Import buy function dynamically to avoid circular dependency
        const { buy } = require('./trade-improvements');
        
        await buy(
          bestCandidate.token,
          bestCandidate.creator,
          bestCandidate.block,
          bestCandidate.initialPrice
        );
      } catch (error) {
        console.error(`[QUEUE] Error executing trade for ${bestCandidate.token}:`, error);
      } finally {
        // Mark trade as complete
        this.activeTrade = null;
        this.tradeInProgress = false;
        this.lastActivityTime = Date.now();
        
        // Reduced delay before processing the next token from 5000ms to 2000ms
        await sleep(2000);
        
        // Process the queue again to select the next token
        setTimeout(() => this.processQueue(), 1000);
      }
    } catch (error) {
      console.error('[QUEUE] Error processing queue:', error);
      this.clearStuckTransactions();
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Check if a trade is currently in progress
   */
  public isTradeInProgress(): boolean {
    return this.tradeInProgress;
  }
  
  /**
   * Get the token currently being traded
   */
  public getActiveToken(): string | null {
    return this.activeTrade;
  }
  
  /**
   * Get the current queue status
   */
  public getQueueStatus(): {
    candidateCount: number;
    activeToken: string | null;
    tradeInProgress: boolean;
    idleSince: number;
  } {
    return {
      candidateCount: this.tokenSelector.getCandidateCount(),
      activeToken: this.activeTrade,
      tradeInProgress: this.tradeInProgress,
      idleSince: Date.now() - this.lastActivityTime
    };
  }
  
  /**
   * Trigger immediate queue processing (useful after a trade completes)
   */
  public triggerProcessing(): void {
    if (!this.processing && !this.tradeInProgress) {
      this.processQueue();
    }
  }
  
  public async selectBestCandidateForTrading(): Promise<TokenCandidate | null> {
    // Get the token selector instance
    const tokenSelector = TokenSelector.getInstance();
    
    // Use the token selector to pick the best candidate
    const bestCandidate = await tokenSelector.selectBestCandidate();
    
    if (bestCandidate) {
      console.log(`[TRADING] Selected token ${bestCandidate.token} for trading with score: ${bestCandidate.score || 'N/A'}`);
    } else {
      console.log(`[TRADING] No suitable token candidate available for trading`);
    }
    
    return bestCandidate;
  }
}
