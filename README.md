# 🚀 Graduation Momentum Retest — Solana Paper Trading Bot

A production-quality Solana memecoin paper trading bot that detects newly graduated/migrated tokens into Raydium liquidity, waits for the first momentum impulse and pullback, then enters only after a clean VWAP retest/reclaim signal.

---

## Strategy Logic

### "Graduation Momentum Retest"

When a memecoin graduates from Pump.fun and migrates to Raydium, it often produces a predictable price pattern:

1. **Migration detected** — Bot subscribes to Raydium v4 program logs and detects `initialize2` instructions.
2. **Impulse** — After pool creation, price pumps sharply (≥80% from observed open).
3. **Pullback** — Price retraces 20–45% from the local high.
4. **Stabilization** — Price consolidates near VWAP.
5. **Reclaim** — Price climbs back above VWAP with positive buy/sell ratio.
6. **Entry** — The bot enters a simulated paper buy after the confirmation window expires.

### State Machine

Each pool transitions through these states:

```
DETECTED → FILTERING → WATCHING_IMPULSE → WAITING_PULLBACK → WAITING_RECLAIM → ENTERED → CLOSED
                                                                              ↓
                                                                          REJECTED / ERROR
```

---

## Paper Trading System

The bot simulates realistic trades including:
- Configurable slippage (base + size impact)
- DEX fee simulation (0.25% Raydium fee)
- Position size capping relative to pool liquidity
- Partial exits at TP1 and TP2
- Trailing stop on the runner position
- Time stop, stop loss, emergency exits
- Realized and unrealized P&L tracking

**All trades are persisted to Supabase and local log file.**

---

## How to Set Up Supabase Tables

1. Log in to [supabase.com](https://supabase.com) and open your project's SQL Editor.
2. Copy and run the contents of `src/storage/schema.sql`.
3. All 7 tables and indexes will be created automatically.

---

## How to Configure `.env`

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `RPC_URL` | Your dedicated Solana RPC HTTP endpoint |
| `WSS_URL` | Your dedicated Solana WSS endpoint |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (for backend use) |
| `SUPABASE_ANON_KEY` | Anon key |
| `TELEGRAM_BOT_TOKEN` | (Optional) Telegram bot token |
| `TELEGRAM_CHAT_ID` | (Optional) Telegram chat ID |
| `PAPER_TRADING` | Set to `true` (default) |
| `POSITION_SIZE_USD` | Size of each paper trade in USD |
| `STOP_LOSS_PERCENT` | Stop loss % from entry |
| `TAKE_PROFIT_1_PERCENT` | Take profit 1 % |
| `TAKE_PROFIT_2_PERCENT` | Take profit 2 % |
| `TIME_STOP_MINUTES` | Max time to hold a trade |
| `MAX_OPEN_POSITIONS` | Concurrent open positions allowed |
| `LOCAL_LOG_PATH` | Path to local log file |

---

## Installation

**Requirements:** Node.js 20+, pnpm

```bash
# Install pnpm if needed
npm install -g pnpm

# Install dependencies
pnpm install

# Copy and configure env
cp .env.example .env
# → Edit .env with your RPC, Supabase credentials, etc.

# Apply Supabase schema
# → Go to your Supabase SQL Editor and run src/storage/schema.sql
```

---

## Running the Bot

### Development Mode (with hot-reload via ts-node)

```bash
pnpm dev
```

### Production Build

```bash
pnpm build
pnpm start
```

### Run Tests

```bash
pnpm test
```

---

## Running with Docker

```bash
# Build and start
docker compose up --build

# Run in background
docker compose up --build -d

# View logs
docker compose logs -f
```

> The `logs/` directory is mounted into the container so logs persist on your host machine.

---

## Viewing Logs

### Local log file
```bash
tail -f ./logs/bot.log
```

**Log format:**
```
timestamp=2026-04-27T12:00:00.000Z | level=INFO | component=Strategy | event=ENTRY_SIGNAL | token=ABC... | pool=XYZ... | tradeId=paper_123 | message="VWAP reclaim confirmed" | data={...}
```

### Supabase
Query your trades directly from Supabase dashboard or via API:

```sql
-- All closed trades
SELECT trade_id, token_mint, entry_price, average_exit_price, realized_pnl_usd, exit_reason
FROM paper_trades
WHERE status = 'CLOSED'
ORDER BY exit_timestamp DESC;

-- Win rate
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE realized_pnl_usd > 0) AS wins,
  ROUND(COUNT(*) FILTER (WHERE realized_pnl_usd > 0) * 100.0 / COUNT(*), 2) AS win_rate_pct,
  SUM(realized_pnl_usd) AS total_pnl
FROM paper_trades
WHERE status = 'CLOSED';

-- Rejection reasons
SELECT rejection_reason, COUNT(*) AS count
FROM strategy_signals
WHERE passed = false
GROUP BY rejection_reason
ORDER BY count DESC;
```

---

## Interpreting P&L

| Field | Meaning |
|---|---|
| `realized_pnl_usd` | Profit/loss from closed portions |
| `unrealized_pnl_usd` | Open position paper gain/loss at last price |
| `fees_usd` | Simulated DEX fees (0.25% of trade size) |
| `slippage_usd` | Estimated slippage cost in USD |
| `realized_pnl_percent` | % return on position size |

---

## Known Limitations

1. **PumpSwap Support Disabled** — Native Pump.fun AMM pools use dynamic bonding curves rather than standard SPL token vaults. As a result, parsing their vault balances fails with standard token layouts. PUMPSWAP pool creation tracking is explicitly commented out in `raydiumPoolWatcher.ts` for V1. The bot currently tracks only Raydium V4, CPMM, and Pump migrations into Raydium.

2. **Pool Detection Accuracy** — Raydium pool keys are extracted using a heuristic account index. For production accuracy, a full instruction decoder for `Initialize2` is recommended. The [Raydium SDK](https://github.com/raydium-io/raydium-sdk) provides this.

3. **Buy/Sell Ratio Approximation** — Without a dedicated indexer, the bot approximates net buy pressure using quote-vault deltas between polling intervals. It is NOT true gross buy/sell swap volume.

4. **Free RPC Limitations** — Free Solana RPC endpoints often have strict rate limits and unstable WSS. Use a dedicated provider (Helius, QuickNode, Triton) for reliable operation.

---

## How to Extend to Live Trading

The bot is designed with a clean paper/live separation:

1. Set `LIVE_TRADING=true` and `PAPER_TRADING=false` in `.env`.
2. Implement a `LiveBroker` class with the same interface as `PaperBroker`, wiring in Jupiter swap execution.
3. Add a real wallet keypair (loaded from env or secrets manager).
4. The strategy engine, risk manager, and position manager require no changes.

> ⚠️ **Never commit private keys to version control. Use environment secrets or a hardware wallet integration.**

---

## Performance Metrics

The bot logs performance snapshots to `performance_snapshots` table and calculates:
- Total trades, open/closed counts
- Win rate %
- Total realized P&L
- Average win/loss
- Profit factor
- Max drawdown
- Best and worst trades
- Average trade duration
- Rejected signal counts by reason

---

## Project Structure

```
src/
  config/        → env.ts, strategyConfig.ts
  core/          → types.ts, errors.ts, constants.ts
  data/          → solanaConnection.ts, raydiumPoolWatcher.ts, marketDataService.ts, priceEngine.ts, swapParser.ts
  filters/       → liquidityFilter.ts, tokenSafetyFilter.ts, devWalletFilter.ts, momentumFilter.ts
  strategy/      → graduationMomentumRetest.ts, strategyStateMachine.ts, signalScorer.ts
  paper/         → paperBroker.ts, positionManager.ts, pnlCalculator.ts, executionSimulator.ts
  risk/          → riskManager.ts, positionSizing.ts
  storage/       → supabaseClient.ts, repositories.ts, schema.sql
  logging/       → logger.ts, localFileLogger.ts
  alerts/        → telegramNotifier.ts
  utils/         → math.ts, time.ts, ids.ts, retry.ts
  index.ts       → Main entrypoint
tests/
  strategy.test.ts → All unit tests
```
