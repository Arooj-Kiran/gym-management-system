import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';
import { users } from './users';

export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    jobTitle: varchar('job_title', { length: 80 }),
    hireDate: date('hire_date', { mode: 'string' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('staff_profiles_user_id_key').on(t.userId),
    check(
      'staff_profiles_notes_length',
      sql`${t.notes} is null or char_length(${t.notes}) <= 1000`,
    ),
  ],
);
