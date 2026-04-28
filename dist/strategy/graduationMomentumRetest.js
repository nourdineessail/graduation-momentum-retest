"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraduationMomentumRetest = void 0;
const strategyStateMachine_1 = require("./strategyStateMachine");
const liquidityFilter_1 = require("../filters/liquidityFilter");
const tokenSafetyFilter_1 = require("../filters/tokenSafetyFilter");
const momentumFilter_1 = require("../filters/momentumFilter");
const signalScorer_1 = require("./signalScorer");
const repositories_1 = require("../storage/repositories");
const logger_1 = require("../logging/logger");
const ids_1 = require("../utils/ids");
const strategyConfig_1 = require("../config/strategyConfig");
const events_1 = require("events");
const localFileLogger_1 = require("../logging/localFileLogger");
class GraduationMomentumRetest extends events_1.EventEmitter {
    stateMachine;
    initialPrices = new Map();
    signalWindowStarts = new Map();
    constructor() {
        super();
        this.stateMachine = new strategyStateMachine_1.StrategyStateMachine();
    }
    async onPoolDetected(pool) {
        this.stateMachine.initializePool(pool);
        // Asynchronous safety check
        const safety = await tokenSafetyFilter_1.TokenSafetyFilter.checkSafety(pool.tokenMint);
        if (!safety.passed) {
            this.rejectPool(pool.poolAddress, `Safety check failed: ${safety.reason}`);
            return;
        }
        this.stateMachine.transition(pool.poolAddress, 'FILTERING');
    }
    onMarketDataUpdate(poolAddress, marketData) {
        const currentState = this.stateMachine.getState(poolAddress);
        if (!currentState || currentState === 'CLOSED' || currentState === 'REJECTED' || currentState === 'ERROR') {
            return;
        }
        const pool = this.stateMachine.getPoolInfo(poolAddress);
        if (!pool)
            return;
        try {
            this.evaluateState(pool, marketData, currentState);
        }
        catch (error) {
            logger_1.logger.error('Error evaluating strategy state', { poolAddress, error });
            this.stateMachine.transition(poolAddress, 'ERROR', String(error));
        }
    }
    evaluateState(pool, marketData, state) {
        // Universal liquidity check - drop immediately if liquidity vanishes
        if (state !== 'DETECTED' && state !== 'FILTERING') {
            const liqCheck = liquidityFilter_1.LiquidityFilter.pass(marketData);
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
                const liqCheck = liquidityFilter_1.LiquidityFilter.pass(marketData);
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
                if (momentumFilter_1.MomentumFilter.checkImpulse(marketData, initialPrice)) {
                    this.stateMachine.transition(pool.poolAddress, 'WAITING_PULLBACK');
                }
                break;
            }
            case 'WAITING_PULLBACK': {
                if (momentumFilter_1.MomentumFilter.checkPullback(marketData)) {
                    this.stateMachine.transition(pool.poolAddress, 'WAITING_RECLAIM');
                }
                else if (marketData.pullbackPercent > strategyConfig_1.strategyConfig.PULLBACK_MAX_PERCENT) {
                    this.rejectPool(pool.poolAddress, `Pullback too deep: ${marketData.pullbackPercent.toFixed(2)}%`);
                }
                break;
            }
            case 'WAITING_RECLAIM': {
                // If price drops too far again, reject
                if (marketData.pullbackPercent > strategyConfig_1.strategyConfig.PULLBACK_MAX_PERCENT) {
                    this.rejectPool(pool.poolAddress, 'Failed reclaim: Pullback exceeded max during reclaim phase');
                    return;
                }
                if (momentumFilter_1.MomentumFilter.checkReclaim(marketData)) {
                    // Reclaim spotted. Now wait for buy pressure confirmation if needed, 
                    // or start the confirmation window
                    if (momentumFilter_1.MomentumFilter.checkBuyPressure(marketData)) {
                        let windowStart = this.signalWindowStarts.get(pool.poolAddress);
                        if (!windowStart) {
                            windowStart = Date.now();
                            this.signalWindowStarts.set(pool.poolAddress, windowStart);
                        }
                        const elapsed = (Date.now() - windowStart) / 1000;
                        if (elapsed >= strategyConfig_1.strategyConfig.ENTRY_CONFIRMATION_WINDOW_SECONDS) {
                            this.generateEntrySignal(pool, marketData);
                            this.stateMachine.transition(pool.poolAddress, 'ENTERED');
                        }
                    }
                    else {
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
    rejectPool(poolAddress, reason) {
        this.stateMachine.transition(poolAddress, 'REJECTED', reason);
        this.initialPrices.delete(poolAddress);
        this.signalWindowStarts.delete(poolAddress);
        logger_1.logger.debug(`Pool ${poolAddress} rejected: ${reason}`);
    }
    generateEntrySignal(pool, marketData) {
        const score = signalScorer_1.SignalScorer.score(marketData);
        const signal = {
            id: `sig_${(0, ids_1.generateId)()}`,
            tokenMint: pool.tokenMint,
            poolAddress: pool.poolAddress,
            signalType: 'ENTRY',
            strength: score,
            price: marketData.price,
            liquidityUsd: marketData.liquidityUsd,
            localHigh: marketData.localHigh,
            pullbackPercent: marketData.pullbackPercent,
            vwap: marketData.vwap,
            buySellRatio: marketData.buySellRatio,
            uniqueBuyers: marketData.uniqueBuyers,
            passed: true,
            timestamp: new Date()
        };
        logger_1.logger.info(`Generated ENTRY signal for ${pool.tokenMint}`, { signalId: signal.id, score });
        localFileLogger_1.LocalFileLogger.log('INFO', 'Strategy', 'ENTRY_SIGNAL', 'VWAP reclaim confirmed', signal, { token: pool.tokenMint, pool: pool.poolAddress });
        repositories_1.Repositories.saveSignal(signal);
        this.emit('signal', signal);
    }
    notifyTradeClosed(poolAddress) {
        this.stateMachine.transition(poolAddress, 'CLOSED');
    }
}
exports.GraduationMomentumRetest = GraduationMomentumRetest;
