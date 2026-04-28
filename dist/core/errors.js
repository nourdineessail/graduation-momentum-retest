"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionSimulatorError = exports.RpcConnectionError = exports.StrategyError = void 0;
class StrategyError extends Error {
    context;
    constructor(message, context) {
        super(message);
        this.context = context;
        this.name = 'StrategyError';
    }
}
exports.StrategyError = StrategyError;
class RpcConnectionError extends Error {
    originalError;
    constructor(message, originalError) {
        super(message);
        this.originalError = originalError;
        this.name = 'RpcConnectionError';
    }
}
exports.RpcConnectionError = RpcConnectionError;
class ExecutionSimulatorError extends Error {
    context;
    constructor(message, context) {
        super(message);
        this.context = context;
        this.name = 'ExecutionSimulatorError';
    }
}
exports.ExecutionSimulatorError = ExecutionSimulatorError;
