import { PoolInfo, StrategyState } from '../core/types';
import { logger } from '../logging/logger';
import { LocalFileLogger } from '../logging/localFileLogger';

export class StrategyStateMachine {
  private states: Map<string, StrategyState> = new Map();
  private poolInfos: Map<string, PoolInfo> = new Map();

  public initializePool(pool: PoolInfo) {
    this.states.set(pool.poolAddress, 'DETECTED');
    this.poolInfos.set(pool.poolAddress, pool);
    this.logStateChange(pool, 'DETECTED');
  }

  public getState(poolAddress: string): StrategyState | undefined {
    return this.states.get(poolAddress);
  }

  public getPoolInfo(poolAddress: string): PoolInfo | undefined {
    return this.poolInfos.get(poolAddress);
  }

  public transition(poolAddress: string, newState: StrategyState, reason?: string) {
    const currentState = this.states.get(poolAddress);
    if (!currentState) {
      logger.warn(`Attempted to transition unknown pool ${poolAddress}`);
      return;
    }

    if (currentState === newState) return;

    this.states.set(poolAddress, newState);
    
    const poolInfo = this.poolInfos.get(poolAddress);
    if (poolInfo) {
      this.logStateChange(poolInfo, newState, reason);
    }
  }

  public removePool(poolAddress: string) {
    this.states.delete(poolAddress);
    this.poolInfos.delete(poolAddress);
  }

  private logStateChange(pool: PoolInfo, state: StrategyState, reason?: string) {
    const reasonStr = reason ? ` - Reason: ${reason}` : '';
    logger.info(`Pool ${pool.poolAddress} transitioned to ${state}${reasonStr}`);
    
    LocalFileLogger.log(
      state === 'ERROR' || state === 'REJECTED' ? 'WARN' : 'INFO',
      'StateMachine',
      `STATE_${state}`,
      `State change${reasonStr}`,
      { state, reason },
      { token: pool.tokenMint, pool: pool.poolAddress }
    );
  }
}
