"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyStateMachine = void 0;
const logger_1 = require("../logging/logger");
const localFileLogger_1 = require("../logging/localFileLogger");
class StrategyStateMachine {
    states = new Map();
    poolInfos = new Map();
    initializePool(pool) {
        this.states.set(pool.poolAddress, 'DETECTED');
        this.poolInfos.set(pool.poolAddress, pool);
        this.logStateChange(pool, 'DETECTED');
    }
    getState(poolAddress) {
        return this.states.get(poolAddress);
    }
    getPoolInfo(poolAddress) {
        return this.poolInfos.get(poolAddress);
    }
    transition(poolAddress, newState, reason) {
        const currentState = this.states.get(poolAddress);
        if (!currentState) {
            logger_1.logger.warn(`Attempted to transition unknown pool ${poolAddress}`);
            return;
        }
        if (currentState === newState)
            return;
        this.states.set(poolAddress, newState);
        const poolInfo = this.poolInfos.get(poolAddress);
        if (poolInfo) {
            this.logStateChange(poolInfo, newState, reason);
        }
    }
    removePool(poolAddress) {
        this.states.delete(poolAddress);
        this.poolInfos.delete(poolAddress);
    }
    logStateChange(pool, state, reason) {
        const reasonStr = reason ? ` - Reason: ${reason}` : '';
        logger_1.logger.info(`Pool ${pool.poolAddress} transitioned to ${state}${reasonStr}`);
        localFileLogger_1.LocalFileLogger.log(state === 'ERROR' || state === 'REJECTED' ? 'WARN' : 'INFO', 'StateMachine', `STATE_${state}`, `State change${reasonStr}`, { state, reason }, { token: pool.tokenMint, pool: pool.poolAddress });
    }
}
exports.StrategyStateMachine = StrategyStateMachine;
