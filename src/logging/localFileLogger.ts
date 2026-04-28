import fs from 'fs';
import path from 'path';

export class LocalFileLogger {
  private static logStream: fs.WriteStream | null = null;
  private static logPath = './logs/bot.log';

  static init(logPath?: string) {
    try {
      // Allow test overrides without importing env
      if (logPath) this.logPath = logPath;
      else {
        // Lazy import so env.ts doesn't throw during unit tests
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.logPath = (require('../config/env').env as { LOCAL_LOG_PATH: string }).LOCAL_LOG_PATH;
      }

      const logDir = path.dirname(this.logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
      this.log('INFO', 'System', 'BOT_STARTUP', 'Local file logger initialized', {});
    } catch (err) {
      console.error('Failed to initialize local file logger', err);
    }
  }

  static log(
    level: 'INFO' | 'WARN' | 'ERROR',
    component: string,
    event: string,
    message: string,
    data?: any,
    identifiers?: { token?: string; pool?: string; tradeId?: string }
  ) {
    if (!this.logStream) return;

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
