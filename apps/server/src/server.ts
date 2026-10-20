import { createApp } from './app';
import { config } from './config/env';
import { closeDb } from './db/client';
import { startScheduler } from './jobs/scheduler';
import { logger } from './lib/logger';
import { accessStream } from './modules/access/access-stream';

const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'API server listening');
});
const stopScheduler = startScheduler();

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  // Open kiosk streams would otherwise keep the server from closing.
  accessStream.closeAll();
  server.close(async () => {
    await stopScheduler();
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
