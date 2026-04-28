"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiquidityFilter = void 0;
const strategyConfig_1 = require("../config/strategyConfig");
const env_1 = require("../config/env");
class LiquidityFilter {
    static pass(marketData) {
        const minLiquidity = env_1.env.MIN_LIQUIDITY_USD || strategyConfig_1.strategyConfig.MIN_LIQUIDITY_USD;
        const maxLiquidity = strategyConfig_1.strategyConfig.MAX_LIQUIDITY_USD;
        if (marketData.liquidityUsd < minLiquidity) {
            return { passed: false, reason: `Liquidity too low: $${marketData.liquidityUsd.toFixed(2)} < $${minLiquidity}` };
        }
        if (maxLiquidity > 0 && marketData.liquidityUsd > maxLiquidity) {
            return { passed: false, reason: `Liquidity too high: $${marketData.liquidityUsd.toFixed(2)} > $${maxLiquidity}` };
        }
        return { passed: true };
    }
}
exports.LiquidityFilter = LiquidityFilter;
