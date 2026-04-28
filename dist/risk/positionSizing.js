"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositionSizing = void 0;
const strategyConfig_1 = require("../config/strategyConfig");
class PositionSizing {
    /**
     * Calculate position size in USD based on configured risk per trade.
     * @param totalPortfolioUsd - total paper portfolio size
     */
    static calculatePositionSizeUsd(totalPortfolioUsd) {
        const riskBased = totalPortfolioUsd * (strategyConfig_1.strategyConfig.RISK_PER_TRADE_PERCENT / 100);
        // Cap at the configured flat position size
        return Math.min(riskBased, strategyConfig_1.strategyConfig.POSITION_SIZE_USD);
    }
}
exports.PositionSizing = PositionSizing;
