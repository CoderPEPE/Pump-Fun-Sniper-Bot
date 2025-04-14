import { sleep } from "dv-sol-lib";

export class AdvancedRateLimiter {
  private static instance: AdvancedRateLimiter;
  private requestCount: { [endpoint: string]: number } = {};
  private lastRequestTime: { [endpoint: string]: number } = {};
  private backoffUntil: number = 0;
  
  // Configurable parameters
  private maxRequestsPerMinute: number = 30; // Reduce from default
  private minDelayBetweenRequests: number = 2000; // Increase from 500ms to 2000ms
  private backoffMultiplier: number = 2;
  private maxBackoff: number = 60000; // 1 minute max backoff
  
  private constructor() {
    // Reset counters every minute
    setInterval(() => {
      this.requestCount = {};
    }, 60000);
  }
  
  public static getInstance(): AdvancedRateLimiter {
    if (!AdvancedRateLimiter.instance) {
      AdvancedRateLimiter.instance = new AdvancedRateLimiter();
    }
    return AdvancedRateLimiter.instance;
  }
  
  public async throttle(endpoint: string = 'default'): Promise<void> {
    const now = Date.now();
    
    // Check global backoff
    if (now < this.backoffUntil) {
      const waitTime = this.backoffUntil - now;
      console.log(`[RATE LIMIT] In global backoff period. Waiting ${waitTime}ms`);
      await sleep(waitTime);
    }
    
    // Initialize counters if needed
    if (!this.requestCount[endpoint]) {
      this.requestCount[endpoint] = 0;
    }
    if (!this.lastRequestTime[endpoint]) {
      this.lastRequestTime[endpoint] = 0;
    }
    
    // Check if we're making too many requests
    if (this.requestCount[endpoint] >= this.maxRequestsPerMinute) {
      const waitTime = 60000 - (now - this.lastRequestTime[endpoint]);
      console.log(`[RATE LIMIT] Too many requests to ${endpoint}. Waiting ${waitTime}ms`);
      await sleep(waitTime);
      this.requestCount[endpoint] = 0;
    }
    
    // Ensure minimum delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime[endpoint];
    if (timeSinceLastRequest < this.minDelayBetweenRequests) {
      const waitTime = this.minDelayBetweenRequests - timeSinceLastRequest;
      await sleep(waitTime);
    }
    
    // Update counters
    this.requestCount[endpoint]++;
    this.lastRequestTime[endpoint] = Date.now();
  }
  
  public recordError(isRateLimitError: boolean): void {
    if (isRateLimitError) {
      const now = Date.now();
      const currentBackoff = Math.max(0, this.backoffUntil - now);
      const newBackoff = Math.min(
        this.maxBackoff,
        (currentBackoff || 5000) * this.backoffMultiplier
      );
      
      this.backoffUntil = now + newBackoff;
      console.log(`[RATE LIMIT] Setting global backoff for ${newBackoff}ms due to rate limit error`);
    }
  }
  
  public recordSuccess(): void {
    // Optionally reduce backoff on success
    const now = Date.now();
    if (now < this.backoffUntil) {
      // Reduce backoff time by 25% on successful request
      const currentBackoff = this.backoffUntil - now;
      this.backoffUntil = now + (currentBackoff * 0.75);
    }
  }
}
