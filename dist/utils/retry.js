"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWithBackoff = retryWithBackoff;
const time_1 = require("./time");
const logger_1 = require("../logging/logger");
async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = 5, baseDelayMs = 500, label = 'operation' } = options;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            const isLast = attempt === maxRetries;
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            if (isLast) {
                logger_1.logger.error(`${label} failed after ${maxRetries} attempts`, { error });
                throw error;
            }
            logger_1.logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, { error: String(error) });
            await (0, time_1.sleep)(delay);
        }
    }
    throw new Error(`retryWithBackoff: exhausted all retries for ${label}`);
}
