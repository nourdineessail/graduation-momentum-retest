"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PnlCalculator = void 0;
class PnlCalculator {
    static calculateUnrealized(entryPrice, currentPrice, quantity) {
        if (entryPrice === 0)
            return { unrealizedPnlUsd: 0, unrealizedPnlPercent: 0 };
        const valueAtEntry = entryPrice * quantity;
        const valueCurrent = currentPrice * quantity;
        const unrealizedPnlUsd = valueCurrent - valueAtEntry;
        const unrealizedPnlPercent = (unrealizedPnlUsd / valueAtEntry) * 100;
        return { unrealizedPnlUsd, unrealizedPnlPercent };
    }
    static calculateRealized(entryPrice, exitPrice, quantitySold) {
        if (entryPrice === 0)
            return 0;
        const valueAtEntry = entryPrice * quantitySold;
        const valueAtExit = exitPrice * quantitySold;
        return valueAtExit - valueAtEntry;
    }
}
exports.PnlCalculator = PnlCalculator;
