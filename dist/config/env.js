"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const envSchema = zod_1.z.object({
    RPC_URL: isTest ? zod_1.z.string().optional().default('http://localhost') : zod_1.z.string().url(),
    WSS_URL: isTest ? zod_1.z.string().optional().default('ws://localhost') : zod_1.z.string().url(),
    SUPABASE_URL: isTest ? zod_1.z.string().optional().default('http://localhost') : zod_1.z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().optional().default('test-key'),
    SUPABASE_ANON_KEY: zod_1.z.string().optional().default('test-anon-key'),
    TELEGRAM_BOT_TOKEN: zod_1.z.string().optional(),
    TELEGRAM_CHAT_ID: zod_1.z.string().optional(),
    PAPER_TRADING: zod_1.z.string().transform((val) => val === 'true').default('true'),
    LIVE_TRADING: zod_1.z.string().transform((val) => val === 'true').default('false'),
    ALLOW_MOCKED_DATA: zod_1.z.string().transform((val) => val === 'true').default('false'),
    ALLOW_PARTIAL_DATA: zod_1.z.string().transform((val) => val === 'true').default('true'),
    POSITION_SIZE_USD: zod_1.z.coerce.number().positive().default(50),
    MIN_LIQUIDITY_USD: zod_1.z.coerce.number().positive().default(10000),
    MAX_SLIPPAGE_PERCENT: zod_1.z.coerce.number().positive().default(5),
    STOP_LOSS_PERCENT: zod_1.z.coerce.number().positive().default(20),
    TAKE_PROFIT_1_PERCENT: zod_1.z.coerce.number().positive().default(25),
    TAKE_PROFIT_2_PERCENT: zod_1.z.coerce.number().positive().default(50),
    TIME_STOP_MINUTES: zod_1.z.coerce.number().positive().default(15),
    MAX_OPEN_POSITIONS: zod_1.z.coerce.number().int().positive().default(3),
    MAX_TRADES_PER_HOUR: zod_1.z.coerce.number().int().positive().default(10),
    LOCAL_LOG_PATH: zod_1.z.string().default('./logs/bot.log'),
});
const _env = envSchema.safeParse(process.env);
if (!_env.success) {
    if (!isTest) {
        console.error('Invalid environment variables', _env.error.format());
        throw new Error('Invalid environment variables');
    }
}
exports.env = (_env.success ? _env.data : envSchema.parse({}));
