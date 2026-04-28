import { sleep } from './time';
import { logger } from '../logging/logger';

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 500, label = 'operation' } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxRetries;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);

      if (isLast) {
        logger.error(`${label} failed after ${maxRetries} attempts`, { error });
        throw error;
      }

      logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, { error: String(error) });
      await sleep(delay);
    }
  }

  throw new Error(`retryWithBackoff: exhausted all retries for ${label}`);
}
