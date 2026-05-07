import { MarketData, PoolInfo, Signal } from '../core/types';
import { StrategyStateMachine } from './strategyStateMachine';
import { LiquidityFilter } from '../filters/liquidityFilter';
import { TokenSafetyFilter } from '../filters/tokenSafetyFilter';
import { MomentumFilter } from '../filters/momentumFilter';
import { SignalScorer } from './signalScorer';
import { Repositories } from '../storage/repositories';
import { logger } from '../logging/logger';
import { generateId } from '../utils/ids';
import { strategyConfig } from '../config/strategyConfig';
import { env } from '../config/env';
import { EventEmitter } from 'events';
import { LocalFileLogger } from '../logging/localFileLogger';

export class GraduationMomentumRetest extends EventEmitter {
  private stateMachine: StrategyStateMachine;
  private initialPrices: Map<string, number> = new Map();
  private signalWindowStarts: Map<string, number> = new Map();

  constructor() {
    super();
    this.stateMachine = new StrategyStateMachine();
  }

  public async onPoolDetected(pool: PoolInfo) {
    this.stateMachine.initializePool(pool);
    
    // Asynchronous safety check
    const safety = await TokenSafetyFilter.checkSafety({
      tokenMint: pool.tokenMint,
      poolAddress: pool.poolAddress,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault
    });
    if (!safety.passed) {
      this.rejectPool(pool.poolAddress, `Safety check failed: ${safety.reason}`);
      return;
    }

    this.stateMachine.transition(pool.poolAddress, 'FILTERING');
  }

  public onMarketDataUpdate(poolAddress: string, marketData: MarketData) {
    const currentState = this.stateMachine.getState(poolAddress);
    if (!currentState || currentState === 'CLOSED' || currentState === 'REJECTED' || currentState === 'ERROR') {
      return;
    }

    const pool = this.stateMachine.getPoolInfo(poolAddress);
    if (!pool) return;

    try {
      this.evaluateState(pool, marketData, currentState);
    } catch (error) {
      logger.error('Error evaluating strategy state', { poolAddress, error });
      this.stateMachine.transition(poolAddress, 'ERROR', String(error));
    }
  }

  private evaluateState(pool: PoolInfo, marketData: MarketData, state: string) {
    if (marketData.dataQuality === 'MOCKED' && !env.ALLOW_MOCKED_DATA) {
      this.rejectPool(pool.poolAddress, 'MOCKED data rejected by env config');
      return;
    }
    if (marketData.dataQuality === 'PARTIAL' && !env.ALLOW_PARTIAL_DATA) {
      this.rejectPool(pool.poolAddress, 'PARTIAL data rejected by env config');
      return;
    }
    if (marketData.dataQuality === 'UNKNOWN') {
      this.rejectPool(pool.poolAddress, 'UNKNOWN data quality rejected');
      return;
    }
    
    // Universal liquidity check - drop immediately if liquidity vanishes
    if (state !== 'DETECTED' && state !== 'FILTERING') {
      const liqCheck = LiquidityFilter.pass(marketData);
      if (!liqCheck.passed) {
        this.rejectPool(pool.poolAddress, `Liquidity drop: ${liqCheck.reason}`);
        
        if (state === 'ENTERED') {
           this.emit('emergencyExit', pool, 'LIQUIDITY_DROP');
        }
        return;
      }
    }

    switch (state) {
      case 'FILTERING': {
        const liqCheck = LiquidityFilter.pass(marketData);
        if (liqCheck.passed) {
          this.initialPrices.set(pool.poolAddress, marketData.price);
          this.stateMachine.transition(pool.poolAddress, 'WATCHING_IMPULSE');
        }
        // If not passed, we wait. It might gather liquidity. 
        // A timeout/age filter should be implemented to kill stale pools.
        break;
      }
      case 'WATCHING_IMPULSE': {
        const initialPrice = this.initialPrices.get(pool.poolAddress) || 0;
        if (MomentumFilter.checkImpulse(marketData, initialPrice)) {
          this.stateMachine.transition(pool.poolAddress, 'WAITING_PULLBACK');
        }
        break;
      }
      case 'WAITING_PULLBACK': {
        if (MomentumFilter.checkPullback(marketData)) {
          this.stateMachine.transition(pool.poolAddress, 'WAITING_RECLAIM');
        } else if (marketData.pullbackPercent > strategyConfig.PULLBACK_MAX_PERCENT) {
          this.rejectPool(pool.poolAddress, `Pullback too deep: ${marketData.pullbackPercent.toFixed(2)}%`);
        }
        break;
      }
      case 'WAITING_RECLAIM': {
        // If price drops too far again, reject
        if (marketData.pullbackPercent > strategyConfig.PULLBACK_MAX_PERCENT) {
          this.rejectPool(pool.poolAddress, 'Failed reclaim: Pullback exceeded max during reclaim phase');
          return;
        }

        if (MomentumFilter.checkReclaim(marketData)) {
          // Reclaim spotted. Now wait for buy pressure confirmation if needed, 
          // or start the confirmation window
          if (MomentumFilter.checkBuyPressure(marketData)) {
            
            let windowStart = this.signalWindowStarts.get(pool.poolAddress);
            if (!windowStart) {
              windowStart = Date.now();
              this.signalWindowStarts.set(pool.poolAddress, windowStart);
            }

            const elapsed = (Date.now() - windowStart) / 1000;
            if (elapsed >= strategyConfig.ENTRY_CONFIRMATION_WINDOW_SECONDS) {
              this.generateEntrySignal(pool, marketData);
              this.stateMachine.transition(pool.poolAddress, 'ENTERED');
            }
          } else {
             // Reset confirmation window if pressure drops
             this.signalWindowStarts.delete(pool.poolAddress);
          }
        }
        break;
      }
      case 'ENTERED':
        // Managed by PaperBroker/PositionManager
        break;
    }
  }

  private rejectPool(poolAddress: string, reason: string) {
    this.stateMachine.transition(poolAddress, 'REJECTED', reason);
    this.initialPrices.delete(poolAddress);
    this.signalWindowStarts.delete(poolAddress);
    logger.debug(`Pool ${poolAddress} rejected: ${reason}`);
  }

  private generateEntrySignal(pool: PoolInfo, marketData: MarketData) {
    const score = SignalScorer.score(marketData);

    const signal: Signal = {
      id: `sig_${generateId()}`,
      tokenMint: pool.tokenMint,
      poolAddress: pool.poolAddress,
      signalType: 'ENTRY',
      strength: score,
      price: marketData.price,
      liquidityUsd: marketData.liquidityUsd,
      localHigh: marketData.localHigh,
      pullbackPercent: marketData.pullbackPercent,
      vwap: marketData.vwap,
      dataQuality: marketData.dataQuality,
      quoteVaultDeltaUsd: marketData.quoteVaultDeltaUsd,
      flowDirection: marketData.flowDirection,
      netBuyPressure: marketData.netBuyPressure,
      uniqueBuyers: marketData.uniqueBuyers,
      passed: true,
      timestamp: new Date()
    };

    logger.info(`Generated ENTRY signal for ${pool.tokenMint}`, { signalId: signal.id, score });
    LocalFileLogger.log('INFO', 'Strategy', 'ENTRY_SIGNAL', 'VWAP reclaim confirmed', signal, { token: pool.tokenMint, pool: pool.poolAddress });
    
    Repositories.saveSignal(signal);
    this.emit('signal', signal);
  }

  public notifyTradeClosed(poolAddress: string) {
    this.stateMachine.transition(poolAddress, 'CLOSED');
  }
}
