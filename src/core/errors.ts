export class StrategyError extends Error {
  constructor(message: string, public readonly context?: any) {
    super(message);
    this.name = 'StrategyError';
  }
}

export class RpcConnectionError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'RpcConnectionError';
  }
}

export class ExecutionSimulatorError extends Error {
  constructor(message: string, public readonly context?: any) {
    super(message);
    this.name = 'ExecutionSimulatorError';
  }
}
