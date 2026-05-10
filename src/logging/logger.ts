import pino from 'pino';

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
    {
      target: 'pino-pretty',
      options: {
        colorize: false,
        translateTime: 'SYS:standard',
        destination: './logs/bot.log',
        append: true
      },
    }
  ],
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  transport
);
