import { supabase } from './supabaseClient';
import { PaperTrade, PoolInfo, Signal } from '../core/types';
import { logger } from '../logging/logger';

export class Repositories {
  static async logEvent(level: string, eventType: string, message: string, data?: any) {
    try {
      const { error } = await supabase.from('bot_events').insert({
        level,
        event_type: eventType,
        message,
        trade_id: data?.tradeId,
        token_mint: data?.tokenMint,
        pool_address: data?.poolAddress,
        data: data ? data : null,
      });
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to log event to Supabase', { err, eventType, message });
    }
  }

  static async saveDetectedPool(pool: PoolInfo) {
    try {
      const { error } = await supabase.from('detected_pools').upsert({
        pool_address: pool.poolAddress,
        token_mint: pool.tokenMint,
        quote_mint: pool.quoteMint,
        base_vault: pool.baseVault,
        quote_vault: pool.quoteVault,
        created_at: pool.createdAt,
      });
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save detected pool', { err, poolAddress: pool.poolAddress });
    }
  }

  static async saveSignal(signal: Signal) {
    try {
      const { error } = await supabase.from('strategy_signals').insert({
        signal_id: signal.id,
        token_mint: signal.tokenMint,
        pool_address: signal.poolAddress,
        signal_type: signal.signalType,
        signal_strength: signal.strength,
        price: signal.price,
        liquidity_usd: signal.liquidityUsd,
        local_high: signal.localHigh,
        pullback_percent: signal.pullbackPercent,
        vwap: signal.vwap,
        net_buy_pressure: signal.netBuyPressure,
        unique_buyers: signal.uniqueBuyers,
        passed: signal.passed,
        rejection_reason: signal.rejectionReason,
        raw_data: signal,
      });
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save signal', { err, signalId: signal.id });
    }
  }

  static async savePaperTrade(trade: PaperTrade) {
    try {
      const { error } = await supabase.from('paper_trades').upsert({
        trade_id: trade.tradeId,
        token_mint: trade.tokenMint,
        pool_address: trade.poolAddress,
        strategy_name: trade.strategyName,
        status: trade.status,
        entry_timestamp: trade.entryTimestamp,
        exit_timestamp: trade.exitTimestamp,
        entry_price: trade.entryPrice,
        average_exit_price: trade.averageExitPrice,
        position_size_usd: trade.positionSizeUsd,
        token_quantity: trade.tokenQuantity,
        realized_pnl_usd: trade.realizedPnlUsd,
        realized_pnl_percent: trade.realizedPnlPercent,
        unrealized_pnl_usd: trade.unrealizedPnlUsd,
        fees_usd: trade.feesUsd,
        slippage_usd: trade.slippageUsd,
        stop_loss_price: trade.stopLossPrice,
        take_profit_1_price: trade.takeProfit1Price,
        take_profit_2_price: trade.takeProfit2Price,
        trailing_stop_price: trade.trailingStopPrice,
        exit_reason: trade.exitReason,
        updated_at: new Date(),
      }, { onConflict: 'trade_id' });
      
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save paper trade', { err, tradeId: trade.tradeId });
    }
  }

  static async savePaperTradeExit(tradeId: string, exitPrice: number, quantitySold: number, realizedPnl: number, exitReason: string, feesUsd: number, slippageUsd: number) {
    try {
      const { error } = await supabase.from('paper_trade_exits').insert({
        trade_id: tradeId,
        exit_price: exitPrice,
        token_quantity: quantitySold,
        realized_pnl_usd: realizedPnl,
        exit_reason: exitReason,
        fees_usd: feesUsd,
        slippage_usd: slippageUsd,
      });
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save paper trade exit', { err, tradeId });
    }
  }

  static async savePerformanceSnapshot(snapshot: any) {
    try {
      const { error } = await supabase.from('performance_snapshots').insert(snapshot);
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save performance snapshot', { err });
    }
  }

  static async saveError(component: string, errorType: string, message: string, errObj?: any) {
    try {
      const { error } = await supabase.from('errors').insert({
        component,
        error_type: errorType,
        message,
        stack: errObj?.stack,
        raw_data: errObj,
      });
      if (error) throw error;
    } catch (err) {
      logger.error('Failed to save error to DB', { err, component, errorType });
    }
  }
}
