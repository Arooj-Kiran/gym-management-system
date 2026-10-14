import { createApp } from './app';
import { config } from './config/env';
import { closeDb } from './db/client';
import { logger } from './lib/logger';

const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'API server listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
