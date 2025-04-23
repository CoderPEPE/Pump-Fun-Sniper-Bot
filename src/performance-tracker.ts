import * as fs from 'fs';
import { PublicKey } from '@solana/web3.js';
import { blackListAdd } from './blacklist';
import { WhitelistRemove } from './whitelist';
import { config } from './config';

interface TradeRecord {
  token: string;
  creator: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  profitPercentage: number;
  timestamp: number;
  executionTime: number;
  success: boolean;
}

interface WalletPerformance {
  wallet: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  averageProfit: number;
  lastTradeTimestamp: number;
  successRate: number;
  trades: TradeRecord[];
}

interface MarketCondition {
  timestamp: number;
  volatilityIndex: number;
  averageSlippage: number;
  recommendedPriorityFee: number;
  tradingRecommendation: 'favorable' | 'neutral' | 'unfavorable';
}

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private walletPerformance: Record<string, WalletPerformance> = {};
  private marketConditions: MarketCondition[] = [];
  private performanceFile = './performance-data.json';
  private marketConditionsFile = './market-conditions.json';
  
  private readonly HIGH_VOLATILITY_THRESHOLD = 90;
  private readonly LOW_VOLATILITY_THRESHOLD = 30;
  
  private readonly GOOD_PERFORMANCE_THRESHOLD = 0.6; 
  private readonly POOR_PERFORMANCE_THRESHOLD = 0.4;
  
  private readonly FEE_INCREASE_FACTOR = 1.5;
  private readonly FEE_DECREASE_FACTOR = 0.8;

  private constructor() {
    this.loadData();
    
    setInterval(() => this.saveData(), 60000);
    
    setInterval(() => this.assessMarketConditions(), 300000);
  }

  public static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  private loadData(): void {
    try {
      if (fs.existsSync(this.performanceFile)) {
        const data = fs.readFileSync(this.performanceFile, 'utf8');
        this.walletPerformance = JSON.parse(data);
        console.log(`Loaded performance data for ${Object.keys(this.walletPerformance).length} wallets`);
      }
      
      if (fs.existsSync(this.marketConditionsFile)) {
        const data = fs.readFileSync(this.marketConditionsFile, 'utf8');
        this.marketConditions = JSON.parse(data);
        console.log(`Loaded ${this.marketConditions.length} market condition records`);
      }
    } catch (error) {
      console.error('Error loading performance data:', error);
    }
  }

  private saveData(): void {
    try {
      fs.writeFileSync(this.performanceFile, JSON.stringify(this.walletPerformance, null, 2));
      fs.writeFileSync(this.marketConditionsFile, JSON.stringify(this.marketConditions, null, 2));
    } catch (error) {
      console.error('Error saving performance data:', error);
    }
  }

  /**
   * Record a completed trade
   */
  public recordTrade(
    token: string,
    creator: string,
    buyPrice: number,
    sellPrice: number,
    profit: number,
    startTime: number,
    endTime: number,
    success: boolean
  ): void {
    const executionTime = (endTime - startTime) / 1000;
    const profitPercentage = (profit / (buyPrice * config.amountTrade)) * 100;
    
    const tradeRecord: TradeRecord = {
      token,
      creator,
      buyPrice,
      sellPrice,
      profit,
      profitPercentage,
      timestamp: endTime,
      executionTime,
      success
    };
    
    if (!this.walletPerformance[creator]) {
      this.walletPerformance[creator] = {
        wallet: creator,
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        totalProfit: 0,
        averageProfit: 0,
        lastTradeTimestamp: 0,
        successRate: 0,
        trades: []
      };
    }
    
    const walletData = this.walletPerformance[creator];
    walletData.totalTrades++;
    if (success) {
      walletData.successfulTrades++;
    } else {
      walletData.failedTrades++;
    }
    
    walletData.totalProfit += profit;
    walletData.averageProfit = walletData.totalProfit / walletData.totalTrades;
    walletData.lastTradeTimestamp = endTime;
    walletData.successRate = walletData.successfulTrades / walletData.totalTrades;
    walletData.trades.push(tradeRecord);
    
    if (walletData.trades.length > 20) {
      walletData.trades = walletData.trades.slice(-20);
    }
    
    this.updateWalletLists(creator, walletData);
    
    this.updateMarketConditions(tradeRecord);
    
    console.log(`[PERFORMANCE] Recorded trade for ${token} by ${creator}: ${profit.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)`);
  }

  /**
   * Update wallet blacklist/whitelist based on performance
   */
  private updateWalletLists(wallet: string, performance: WalletPerformance): void {
    if (performance.totalTrades < 3) {
      return;
    }
    
    if (performance.successRate < this.POOR_PERFORMANCE_THRESHOLD) {
      console.log(`[PERFORMANCE] Adding ${wallet} to blacklist due to poor performance (${(performance.successRate * 100).toFixed(2)}% success rate)`);
      blackListAdd(wallet);
      return;
    }
    
    if (performance.successRate < this.GOOD_PERFORMANCE_THRESHOLD) {
      console.log(`[PERFORMANCE] Removing ${wallet} from whitelist due to mediocre performance (${(performance.successRate * 100).toFixed(2)}% success rate)`);
      WhitelistRemove(wallet);
    }
  }

  /**
   * Update market conditions based on recent trade data
   */
  private updateMarketConditions(trade: TradeRecord): void {
    const recentTime = Date.now() - 10 * 60 * 1000;
    const recentTrades: TradeRecord[] = [];
    
    for (const wallet of Object.values(this.walletPerformance)) {
      recentTrades.push(...wallet.trades.filter(t => t.timestamp > recentTime));
    }
    
    if (recentTrades.length === 0) {
      return;
    }
    
    const profitPercentages = recentTrades.map(t => t.profitPercentage);
    const avgProfit = profitPercentages.reduce((sum, val) => sum + val, 0) / profitPercentages.length;
    const variance = profitPercentages.reduce((sum, val) => sum + Math.pow(val - avgProfit, 2), 0) / profitPercentages.length;
    const volatilityIndex = Math.min(100, Math.max(0, Math.sqrt(variance) * 5)); // Scale appropriately
    
    const avgSlippage = recentTrades.reduce((sum, t) => sum + Math.abs(t.sellPrice - t.buyPrice) / t.buyPrice, 0) / recentTrades.length * 100;
    
    let recommendedPriorityFee = config.prioityFee;
    if (volatilityIndex > this.HIGH_VOLATILITY_THRESHOLD) {
      recommendedPriorityFee *= this.FEE_INCREASE_FACTOR;
    } else if (volatilityIndex < this.LOW_VOLATILITY_THRESHOLD) {
      recommendedPriorityFee *= this.FEE_DECREASE_FACTOR;
    }
    
    let tradingRecommendation: 'favorable' | 'neutral' | 'unfavorable';
    if (volatilityIndex > this.HIGH_VOLATILITY_THRESHOLD) {
      tradingRecommendation = 'unfavorable';
    } else if (volatilityIndex < this.LOW_VOLATILITY_THRESHOLD && avgProfit > 0) {
      tradingRecommendation = 'favorable';
    } else {
      tradingRecommendation = 'neutral';
    }
    
    const marketCondition: MarketCondition = {
      timestamp: Date.now(),
      volatilityIndex,
      averageSlippage: avgSlippage,
      recommendedPriorityFee,
      tradingRecommendation
    };
    
    this.marketConditions.push(marketCondition);
    
    if (this.marketConditions.length > 100) {
      this.marketConditions = this.marketConditions.slice(-100);
    }
    
    console.log(`[MARKET] Current volatility: ${volatilityIndex.toFixed(2)}, Trading recommendation: ${tradingRecommendation}`);
  }

  /**
   * Assess current market conditions and update dynamic parameters
   */
  private assessMarketConditions(): void {
    if (this.marketConditions.length === 0) {
      return;
    }
    
    const currentCondition = this.marketConditions[this.marketConditions.length - 1];
    
    if (currentCondition.volatilityIndex > this.HIGH_VOLATILITY_THRESHOLD) {
      this.updateDynamicParameters({
        slippage: Math.min(200, config.slippage * 1.5),
        prioityFee: Math.max(1, currentCondition.recommendedPriorityFee),
        jitoBuyTip: config.jitoBuyTip * 1.5,
        jitoSellTip: config.jitoSellTip * 1.5
      });
      
      console.log(`[MARKET] High volatility detected (${currentCondition.volatilityIndex.toFixed(2)}). Adjusting parameters for conservative trading.`);
    } else if (currentCondition.volatilityIndex < this.LOW_VOLATILITY_THRESHOLD) {
      this.updateDynamicParameters({
        slippage: Math.max(50, config.slippage * 0.8),
        prioityFee: Math.max(1, currentCondition.recommendedPriorityFee),
        jitoBuyTip: config.jitoBuyTip * 0.8,
        jitoSellTip: config.jitoSellTip * 0.8
      });
      
      console.log(`[MARKET] Low volatility detected (${currentCondition.volatilityIndex.toFixed(2)}). Adjusting parameters for aggressive trading.`);
    }
  }

  /**
   * Update dynamic parameters in the config
   */
  private updateDynamicParameters(params: Partial<Config>): void {
    Object.assign(config, params);
    
    console.log('[CONFIG] Dynamic parameters updated:', params);
  }

  /**
   * Get current market conditions
   */
  public getCurrentMarketConditions(): MarketCondition | null {
    if (this.marketConditions.length === 0) {
      return null;
    }
    return this.marketConditions[this.marketConditions.length - 1];
  }

  /**
   * Check if current market conditions are favorable for trading
   */
  public isFavorableForTrading(): boolean {
    return true;
    
    // Original implementation (commented out)
    /*
    const currentCondition = this.getCurrentMarketConditions();
    if (!currentCondition) {
      return true; // Default to true if no data available
    }
    
    return currentCondition.tradingRecommendation !== 'unfavorable';
    */
  }

  /**
   * Get dynamic stop loss based on market conditions
   */
  public getDynamicStopLoss(initialPrice: number): number {
    const currentCondition = this.getCurrentMarketConditions();
    let stopLoss = config.sl; 
    
    if (currentCondition) {
      if (currentCondition.volatilityIndex > this.HIGH_VOLATILITY_THRESHOLD) {
        stopLoss = Math.max(30, stopLoss * 0.8);
      } else if (currentCondition.volatilityIndex < this.LOW_VOLATILITY_THRESHOLD) {
        stopLoss = Math.min(80, stopLoss * 1.2);
      }
    }
    
    return stopLoss;
  }

  /**
   * Get dynamic take profit based on market conditions
   */
  public getDynamicTakeProfit(initialPrice: number): number {
    const currentCondition = this.getCurrentMarketConditions();
    let takeProfit = config.tp; 
    
    if (currentCondition) {
      if (currentCondition.volatilityIndex > this.HIGH_VOLATILITY_THRESHOLD) {
        takeProfit = Math.min(20, takeProfit * 1.5);
      } else if (currentCondition.volatilityIndex < this.LOW_VOLATILITY_THRESHOLD) {
        takeProfit = Math.max(5, takeProfit * 0.9);
      }
    }
    
    return takeProfit;
  }

  /**
   * Get recommended priority fee based on market conditions
   */
  public getRecommendedPriorityFee(): number {
    const currentCondition = this.getCurrentMarketConditions();
    if (!currentCondition) {
      return config.prioityFee;
    }
    
    return currentCondition.recommendedPriorityFee;
  }

  /**
   * Get wallet performance data
   */
  public getWalletPerformance(wallet: string): WalletPerformance | null {
    return this.walletPerformance[wallet] || null;
  }
}

interface Config {
  slippage: number;
  prioityFee: number;
  jitoBuyTip: number;
  jitoSellTip: number;
}
