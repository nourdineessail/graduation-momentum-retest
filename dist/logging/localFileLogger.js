"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalFileLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LocalFileLogger {
    static logStream = null;
    static logPath = './logs/bot.log';
    static init(logPath) {
        try {
            // Allow test overrides without importing env
            if (logPath)
                this.logPath = logPath;
            else {
                // Lazy import so env.ts doesn't throw during unit tests
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                this.logPath = require('../config/env').env.LOCAL_LOG_PATH;
            }
            const logDir = path_1.default.dirname(this.logPath);
            if (!fs_1.default.existsSync(logDir)) {
                fs_1.default.mkdirSync(logDir, { recursive: true });
            }
            this.logStream = fs_1.default.createWriteStream(this.logPath, { flags: 'a' });
            this.log('INFO', 'System', 'BOT_STARTUP', 'Local file logger initialized', {});
        }
        catch (err) {
            console.error('Failed to initialize local file logger', err);
        }
    }
    static log(level, component, event, message, data, identifiers) {
        if (!this.logStream)
            return;
        const timestamp = new Date().toISOString();
        const tokenPart = identifiers?.token ? ` | token=${identifiers.token}` : '';
        const poolPart = identifiers?.pool ? ` | pool=${identifiers.pool}` : '';
        const tradePart = identifiers?.tradeId ? ` | tradeId=${identifiers.tradeId}` : '';
        const dataPart = data ? ` | data=${JSON.stringify(data)}` : '';
        const logLine = `timestamp=${timestamp} | level=${level} | component=${component} | event=${event}${tokenPart}${poolPart}${tradePart} | message="${message}"${dataPart}\n`;
        this.logStream.write(logLine);
    }
    static shutdown() {
        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
    }
}
exports.LocalFileLogger = LocalFileLogger;
