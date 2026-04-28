export class PnlCalculator {
  static calculateUnrealized(
    entryPrice: number,
    currentPrice: number,
    quantity: number
  ): { unrealizedPnlUsd: number; unrealizedPnlPercent: number } {
    if (entryPrice === 0) return { unrealizedPnlUsd: 0, unrealizedPnlPercent: 0 };
    
    const valueAtEntry = entryPrice * quantity;
    const valueCurrent = currentPrice * quantity;
    
    const unrealizedPnlUsd = valueCurrent - valueAtEntry;
    const unrealizedPnlPercent = (unrealizedPnlUsd / valueAtEntry) * 100;
    
    return { unrealizedPnlUsd, unrealizedPnlPercent };
  }

  static calculateRealized(
    entryPrice: number,
    exitPrice: number,
    quantitySold: number
  ): number {
    if (entryPrice === 0) return 0;
    const valueAtEntry = entryPrice * quantitySold;
    const valueAtExit = exitPrice * quantitySold;
    return valueAtExit - valueAtEntry;
  }
}
