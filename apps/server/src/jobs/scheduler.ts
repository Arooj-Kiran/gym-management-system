import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { expireMemberships } from './expire-memberships';

/** 00:05 gym time, every day. */
const EXPIRY_SCHEDULE = '5 0 * * *';

async function runExpiry(trigger: 'startup' | 'schedule') {
  try {
    const result = await expireMemberships();
    if (result.ran) {
      logger.info({ job: 'membership-expiry', trigger, expired: result.expired }, 'Expiry job ran');
    } else {
      logger.info(
        { job: 'membership-expiry', trigger },
        'Expiry job skipped: another run holds the lock',
      );
    }
  } catch (error) {
    logger.error({ err: error, job: 'membership-expiry', trigger }, 'Expiry job failed');
  }
}

/**
 * Starts the background jobs. The expiry job also runs once at startup, so a server that was
 * down at 00:05 catches up straight away. Returns a stop function for graceful shutdown.
 */
export function startScheduler(): () => Promise<void> {
  const tasks: ScheduledTask[] = [
    cron.schedule(EXPIRY_SCHEDULE, () => runExpiry('schedule'), {
      timezone: config.gymTimezone,
      name: 'membership-expiry',
      noOverlap: true,
    }),
  ];
  void runExpiry('startup');
  return async () => {
    await Promise.all(tasks.map((task) => task.destroy()));
  };
}
