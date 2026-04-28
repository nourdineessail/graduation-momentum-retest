"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clamp = clamp;
exports.percentChange = percentChange;
exports.pullbackPercent = pullbackPercent;
exports.roundTo = roundTo;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function percentChange(from, to) {
    if (from === 0)
        return 0;
    return ((to - from) / from) * 100;
}
function pullbackPercent(localHigh, currentPrice) {
    if (localHigh === 0)
        return 0;
    return ((localHigh - currentPrice) / localHigh) * 100;
}
function roundTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
