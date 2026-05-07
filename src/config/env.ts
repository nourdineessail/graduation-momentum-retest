import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const envSchema = z.object({
  RPC_URL: isTest ? z.string().optional().default('http://localhost') : z.string().url(),
  WSS_URL: isTest ? z.string().optional().default('ws://localhost') : z.string().url(),
  SUPABASE_URL: isTest ? z.string().optional().default('http://localhost') : z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default('test-key'),
  SUPABASE_ANON_KEY: z.string().optional().default('test-anon-key'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  PAPER_TRADING: z.string().transform((val) => val === 'true').default('true'),
  LIVE_TRADING: z.string().transform((val) => val === 'true').default('false'),

  ALLOW_MOCKED_DATA: z.string().transform((val) => val === 'true').default('false'),
  ALLOW_PARTIAL_DATA: z.string().transform((val) => val === 'true').default('true'),

  POSITION_SIZE_USD: z.coerce.number().positive().default(50),
  MIN_LIQUIDITY_USD: z.coerce.number().positive().default(10000),
  MAX_SLIPPAGE_PERCENT: z.coerce.number().positive().default(5),
  STOP_LOSS_PERCENT: z.coerce.number().positive().default(20),
  TAKE_PROFIT_1_PERCENT: z.coerce.number().positive().default(25),
  TAKE_PROFIT_2_PERCENT: z.coerce.number().positive().default(50),
  TIME_STOP_MINUTES: z.coerce.number().positive().default(15),
  MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(3),
  MAX_TRADES_PER_HOUR: z.coerce.number().int().positive().default(10),

  MAX_DAILY_LOSS_USD: z.coerce.number().positive().default(100),
  MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().positive().default(4),
  COOLDOWN_AFTER_LOSSES_MINUTES: z.coerce.number().positive().default(30),
  PER_TOKEN_COOLDOWN_MINUTES: z.coerce.number().positive().default(60),
  STALE_DATA_MAX_SECONDS: z.coerce.number().positive().default(20),

  LOCAL_LOG_PATH: z.string().default('./logs/bot.log'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  if (!isTest) {
    console.error('Invalid environment variables', _env.error.format());
    throw new Error('Invalid environment variables');
  }
}

export const env = (_env.success ? _env.data : envSchema.parse({})) as z.infer<typeof envSchema>;
