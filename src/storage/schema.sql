-- Supabase Schema for Solana Memecoin Paper Trading Bot

-- 1. bot_events
CREATE TABLE bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  trade_id VARCHAR(100),
  token_mint VARCHAR(100),
  pool_address VARCHAR(100),
  data JSONB
);

-- 2. detected_pools
CREATE TABLE detected_pools (
  pool_address VARCHAR(100) PRIMARY KEY,
  token_mint VARCHAR(100) NOT NULL,
  quote_mint VARCHAR(100) NOT NULL,
  base_vault VARCHAR(100) NOT NULL,
  quote_vault VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. strategy_signals
CREATE TABLE strategy_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id VARCHAR(100) NOT NULL UNIQUE,
  token_mint VARCHAR(100) NOT NULL,
  pool_address VARCHAR(100) NOT NULL,
  signal_type VARCHAR(50) NOT NULL,
  signal_strength NUMERIC,
  price NUMERIC NOT NULL,
  liquidity_usd NUMERIC NOT NULL,
  local_high NUMERIC,
  pullback_percent NUMERIC,
  vwap NUMERIC,
  buy_sell_ratio NUMERIC,
  unique_buyers INTEGER,
  unique_sellers INTEGER,
  passed BOOLEAN NOT NULL,
  rejection_reason VARCHAR(255),
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. paper_trades
CREATE TABLE paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id VARCHAR(100) NOT NULL UNIQUE,
  token_mint VARCHAR(100) NOT NULL,
  pool_address VARCHAR(100) NOT NULL,
  strategy_name VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL,
  exit_timestamp TIMESTAMPTZ,
  entry_price NUMERIC NOT NULL,
  average_exit_price NUMERIC,
  position_size_usd NUMERIC NOT NULL,
  token_quantity NUMERIC NOT NULL,
  realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  realized_pnl_percent NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  fees_usd NUMERIC NOT NULL DEFAULT 0,
  slippage_usd NUMERIC NOT NULL DEFAULT 0,
  stop_loss_price NUMERIC NOT NULL,
  take_profit_1_price NUMERIC NOT NULL,
  take_profit_2_price NUMERIC NOT NULL,
  trailing_stop_price NUMERIC NOT NULL,
  exit_reason VARCHAR(100),
  signal_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. paper_trade_exits
CREATE TABLE paper_trade_exits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id VARCHAR(100) NOT NULL REFERENCES paper_trades(trade_id),
  exit_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_price NUMERIC NOT NULL,
  token_quantity NUMERIC NOT NULL,
  realized_pnl_usd NUMERIC NOT NULL,
  exit_reason VARCHAR(100) NOT NULL,
  fees_usd NUMERIC NOT NULL DEFAULT 0,
  slippage_usd NUMERIC NOT NULL DEFAULT 0
);

-- 6. performance_snapshots
CREATE TABLE performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_trades INTEGER NOT NULL,
  open_trades INTEGER NOT NULL,
  closed_trades INTEGER NOT NULL,
  win_rate NUMERIC NOT NULL,
  total_realized_pnl_usd NUMERIC NOT NULL,
  average_win_usd NUMERIC,
  average_loss_usd NUMERIC,
  profit_factor NUMERIC,
  max_drawdown_usd NUMERIC,
  best_trade_usd NUMERIC,
  worst_trade_usd NUMERIC,
  average_trade_duration_seconds NUMERIC,
  rejected_signals_count INTEGER NOT NULL,
  raw_data JSONB
);

-- 7. errors
CREATE TABLE errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  component VARCHAR(100) NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  raw_data JSONB
);

-- Indexes for performance
CREATE INDEX idx_bot_events_trade_id ON bot_events(trade_id);
CREATE INDEX idx_bot_events_token_mint ON bot_events(token_mint);
CREATE INDEX idx_strategy_signals_token_mint ON strategy_signals(token_mint);
CREATE INDEX idx_paper_trades_token_mint ON paper_trades(token_mint);
CREATE INDEX idx_paper_trades_status ON paper_trades(status);
