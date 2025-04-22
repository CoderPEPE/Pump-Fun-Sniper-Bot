import { config } from "./config";
import { getCurrentTimestamp, pfGetTokenDataByApi, sleep, solPFFetchPrice } from "dv-sol-lib";
import { PerformanceTracker } from "./performance-tracker";
import { rateLimiter } from "./config";
import { logger } from "./logger";
export interface TokenCandidate {
  token: string;
  creator: string;
  initialPrice?: number;
  detectedAt: number;
  block?: number;
  initialBuy?: number;
  score?: number;
}
interface ProfitabilityResult {
  isProfitable: boolean;
  profitAfterFees: number;
  expectedProfit: number;
  totalFees: number;
  currentPrice?: number;
}
interface CachedResult {
  timestamp: number;
  result: ProfitabilityResult;
}

/**
 * TokenSelector class for dynamically selecting the most profitable token to trade
 */
export class TokenSelector {
  private static instance: TokenSelector;
  private candidates: TokenCandidate[] = [];
  private cachedProfitabilityResults = new Map<string, CachedResult>();
  
  private readonly MAX_CANDIDATES = 50; // Maximum number of candidates to keep in memory
  private readonly CANDIDATE_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly CACHE_EXPIRY_TIME = 30 * 1000; // 30 seconds
  private readonly BASE_TRANSACTION_FEE = 0.000005; // SOL
  private readonly COMPUTE_UNITS_ESTIMATE = 1500;
  private readonly performanceTracker = PerformanceTracker.getInstance();
  
  private constructor() {
    setInterval(() => this.cleanupExpiredCandidates(), 60000);
  }
  
  public static getInstance(): TokenSelector {
    if (!TokenSelector.instance) {
      TokenSelector.instance = new TokenSelector();
    }
    return TokenSelector.instance;
  }
  
  /**
   * Add a token candidate to the selection pool
   */
  public addCandidate(candidate: TokenCandidate): void {
    if (!candidate.detectedAt) {
      candidate.detectedAt = getCurrentTimestamp();
    }
    
    this.candidates.push(candidate);
    logger.info(`[SELECTOR] Added ${candidate.token} to candidate pool. Total candidates: ${this.candidates.length}`);
    
    if (this.candidates.length > this.MAX_CANDIDATES) {
      this.candidates.sort((a, b) => b.detectedAt - a.detectedAt);
      this.candidates = this.candidates.slice(0, this.MAX_CANDIDATES);
    }
  }
  
  /**
   * Remove expired candidates
   */
  private cleanupExpiredCandidates(): void {
    const now = getCurrentTimestamp();
    const initialCount = this.candidates.length;
    
    this.candidates = this.candidates.filter(candidate => 
      (now - candidate.detectedAt) < this.CANDIDATE_EXPIRY_TIME
    );
    
    for (const [key, value] of this.cachedProfitabilityResults.entries()) {
      if (now - value.timestamp > this.CACHE_EXPIRY_TIME) {
        this.cachedProfitabilityResults.delete(key);
      }
    }
    
    const removedCount = initialCount - this.candidates.length;
    if (removedCount > 0) {
      logger.info(`[SELECTOR] Removed ${removedCount} expired candidates. Remaining: ${this.candidates.length}`);
    }
  }
  
  /**
   * Calculate estimated fees for a trade
   */
  private calculateEstimatedFees(tradeAmount: number, priorityFee: number, jitoTip: number, slippage: number): number {
    const estimatedPriorityFee = priorityFee * 0.000001 * this.COMPUTE_UNITS_ESTIMATE;
    
    const estimatedSlippage = (tradeAmount * slippage) / 100;
    
    return this.BASE_TRANSACTION_FEE + estimatedPriorityFee + jitoTip + estimatedSlippage;
  }
  
  /**
   * Check if a trade is likely to be profitable after fees
   */
  private async isProfitableTrade(token: string, initialPrice: number, tradeAmount: number): Promise<ProfitabilityResult> {
    const cacheKey = `${token}_${initialPrice}_${tradeAmount}`;
    const cachedResult = this.cachedProfitabilityResults.get(cacheKey);
    if (cachedResult && (getCurrentTimestamp() - cachedResult.timestamp < this.CACHE_EXPIRY_TIME)) {
      return cachedResult.result;
    }
    
    const takeProfit = config.tp;
    
    let currentPrice = initialPrice;
    try {
      await rateLimiter.throttle('price_fetch');
      const fetchedPrice = await solPFFetchPrice(token);
      logger.info(`[SELECTOR] Fetched price for ${token}: ${fetchedPrice}`);
      if (fetchedPrice) {
        currentPrice = fetchedPrice;
      }
    } catch (error) {
      logger.error(`[SELECTOR] Error fetching current price for ${token}: ${error}`);
    }
    
    const expectedProfit = (tradeAmount * takeProfit) / 100;
    
    const buyFees = this.calculateEstimatedFees(
      tradeAmount,
      config.prioityFee,
      config.jitoBuyTip,
      config.slippage
    );
    
    const sellFees = this.calculateEstimatedFees(
      tradeAmount * (1 + takeProfit/100),
      config.prioityFee,
      config.jitoSellTip,
      config.slippage
    );
    
    const totalFees = buyFees + sellFees;
    
    const profitAfterFees = expectedProfit - totalFees;
    
    const isProfitable = profitAfterFees > 0;
    
    const result = {
      isProfitable,
      profitAfterFees,
      expectedProfit,
      totalFees,
      currentPrice
    };
    
    this.cachedProfitabilityResults.set(cacheKey, {
      timestamp: getCurrentTimestamp(),
      result
    });
    
    return result;
  }
  
  /**
   * Calculate a score for a token candidate based on various factors
   */
  private async calculateCandidateScore(candidate: TokenCandidate): Promise<number> {
    try {
      let score = 50;
      
      const profitability = await this.isProfitableTrade(
        candidate.token,
        candidate.initialPrice || 0,
        config.amountTrade
      );
      
      logger.info(`[SELECTOR] ${candidate.token} profitability check:
        Initial price: ${candidate.initialPrice}
        Current price: ${profitability.currentPrice}
        Expected profit: ${profitability.expectedProfit.toFixed(6)} SOL
        Total fees: ${profitability.totalFees.toFixed(6)} SOL
        Profit after fees: ${profitability.profitAfterFees.toFixed(6)} SOL
        Is profitable: ${profitability.isProfitable}
      `);
      
      if (profitability.isProfitable) {
        score += profitability.profitAfterFees * 100;
      } else {
        score -= 50;
      }
      
      const walletPerformance = this.performanceTracker.getWalletPerformance(candidate.creator);
      if (walletPerformance) {
        if (walletPerformance.totalTrades > 3) {
          score += walletPerformance.successRate * 50;
        }
        
        if (walletPerformance.averageProfit > 0) {
          score += walletPerformance.averageProfit * 20;
        }
      }
      
      const ageInMinutes = (getCurrentTimestamp() - candidate.detectedAt) / 60000;
      score -= ageInMinutes * 2; 
      
      if (candidate.initialBuy) {
        if (candidate.initialBuy >= 0.5 && candidate.initialBuy <= 2.0) {
          score += 20; 
        } else if (candidate.initialBuy > 2.0 && candidate.initialBuy <= 3.0) {
          score += 10; 
        }
      }
      
      const isWhitelisted = config.whitelist.includes(candidate.creator);
      const isGoodMaker = config.goodMakers.includes(candidate.creator);

      if (isWhitelisted) {
        score += 30; 
        logger.info(`[SELECTOR] ${candidate.token} creator is whitelisted (+30 points)`);
      }
      if (isGoodMaker) {
        score += 50; 
        logger.info(`[SELECTOR] ${candidate.token} creator is a good maker (+50 points)`);
      }
      
      return Math.max(0, score);
    } catch (error) {
      logger.error(`Error calculating score for ${candidate.token}:`, error);
      return 0;
    }
  }
  
  /**
   * Select the best token candidate for trading
   */
  public async selectBestCandidate(): Promise<TokenCandidate | null> {
    if (this.candidates.length === 0) {
      logger.info(`[SELECTOR] No candidates available for selection`);
      return null;
    }
    
    logger.info(`[SELECTOR] Evaluating ${this.candidates.length} candidates for trading`);
    
    const scoringPromises = this.candidates.map(async candidate => {
      try {
        const score = await this.calculateCandidateScore(candidate);
        return { ...candidate, score };
      } catch (error) {
        logger.error(`[SELECTOR] Error calculating score for ${candidate.token}:`, error);
        return { ...candidate, score: 0 };
      }
    });
    
    const scoredCandidates = await Promise.all(scoringPromises);
    
    scoredCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    if (scoredCandidates.length > 0) {
      logger.info(`[SELECTOR] Top candidates:`);
      scoredCandidates.slice(0, Math.min(5, scoredCandidates.length)).forEach((candidate, index) => {
        logger.info(`[SELECTOR] ${index + 1}. ${candidate.token} (Score: ${candidate.score?.toFixed(2)}, InitialBuy: ${candidate.initialBuy})`);
      });
    } else {
      logger.info(`[SELECTOR] No candidates found with scores`);
      return null;
    }
    
    logger.info(`[SELECTOR] Filtering ${scoredCandidates.length} candidates for profitability`);
    
    const profitableCandidates = scoredCandidates.filter(candidate => {
      const hasProfitabilityCheck = candidate.score !== undefined;
      const isPositiveScore = (candidate.score || 0) > 0;
      
      logger.debug(`[SELECTOR] Candidate ${candidate.token} - Has profitability check: ${hasProfitabilityCheck}, Score: ${candidate.score}, Is profitable: ${isPositiveScore}`);
      
      return hasProfitabilityCheck && isPositiveScore;
    });
    
    logger.info(`[SELECTOR] Found ${profitableCandidates.length} profitable candidates out of ${scoredCandidates.length} total`);
    
    if (profitableCandidates.length === 0) {
      logger.info(`[SELECTOR] No profitable candidates found`);
      return null;
    }
    
    const selectedCandidate = profitableCandidates[0];
    
    if (selectedCandidate) {
      this.candidates = this.candidates.filter(c => c.token !== selectedCandidate.token);
      
      logger.info(`[SELECTOR] Selected ${selectedCandidate.token} for trading with score ${selectedCandidate.score?.toFixed(2)}`);
      return selectedCandidate;
    }
    
    return null;
  }
  
  /**
   * Get the number of available candidates
   */
  public getCandidateCount(): number {
    return this.candidates.length;
  }
}
