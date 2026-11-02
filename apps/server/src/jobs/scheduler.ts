import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { dispatchNotifications } from './dispatch-notifications';
import { expireMemberships } from './expire-memberships';
import { markOverdue } from './mark-overdue-invoices';
import { sendReminders } from './notification-reminders';

/** 00:05 gym time, every day. */
const EXPIRY_SCHEDULE = '5 0 * * *';
/** 00:10 gym time, every day. */
const OVERDUE_SCHEDULE = '10 0 * * *';
/** Quarter past every hour: class and appointment reminders need to be within the day. */
const REMINDERS_SCHEDULE = '15 * * * *';
/** Every minute: new notifications go out over the configured channels. */
const DISPATCH_SCHEDULE = '* * * * *';

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

async function runOverdue(trigger: 'startup' | 'schedule') {
  try {
    const result = await markOverdue();
    if (result.ran) {
      logger.info({ job: 'invoice-overdue', trigger, marked: result.marked }, 'Overdue job ran');
    } else {
      logger.info(
        { job: 'invoice-overdue', trigger },
        'Overdue job skipped: another run holds the lock',
      );
    }
  } catch (error) {
    logger.error({ err: error, job: 'invoice-overdue', trigger }, 'Overdue job failed');
  }
}

async function runReminders(trigger: 'startup' | 'schedule') {
  try {
    const result = await sendReminders();
    if (result.ran) {
      logger.info(
        { job: 'notification-reminders', trigger, created: result.created },
        'Reminders job ran',
      );
    } else {
      logger.info(
        { job: 'notification-reminders', trigger },
        'Reminders job skipped: another run holds the lock',
      );
    }
  } catch (error) {
    logger.error({ err: error, job: 'notification-reminders', trigger }, 'Reminders job failed');
  }
}

async function runDispatch(trigger: 'startup' | 'schedule') {
  try {
    const result = await dispatchNotifications();
    // Logged only when something happened: this runs every minute.
    if (result.notifications > 0) {
      logger.info(
        { job: 'notification-dispatch', trigger, ...result },
        'Notification dispatch ran',
      );
    }
  } catch (error) {
    logger.error({ err: error, job: 'notification-dispatch', trigger }, 'Dispatch job failed');
  }
}

/**
 * Starts the background jobs. All of them also run once at startup, so a server that was down at
 * midnight catches up straight away. Returns a stop function for graceful shutdown.
 */
export function startScheduler(): () => Promise<void> {
  const tasks: ScheduledTask[] = [
    cron.schedule(EXPIRY_SCHEDULE, () => runExpiry('schedule'), {
      timezone: config.gymTimezone,
      name: 'membership-expiry',
      noOverlap: true,
    }),
    cron.schedule(OVERDUE_SCHEDULE, () => runOverdue('schedule'), {
      timezone: config.gymTimezone,
      name: 'invoice-overdue',
      noOverlap: true,
    }),
    cron.schedule(REMINDERS_SCHEDULE, () => runReminders('schedule'), {
      timezone: config.gymTimezone,
      name: 'notification-reminders',
      noOverlap: true,
    }),
    cron.schedule(DISPATCH_SCHEDULE, () => runDispatch('schedule'), {
      timezone: config.gymTimezone,
      name: 'notification-dispatch',
      noOverlap: true,
    }),
  ];
  // Expiry and overdue first, so the reminders see today's statuses.
  void Promise.all([runExpiry('startup'), runOverdue('startup')])
    .then(() => runReminders('startup'))
    .then(() => runDispatch('startup'));
  return async () => {
    await Promise.all(tasks.map((task) => task.destroy()));
  };
}
