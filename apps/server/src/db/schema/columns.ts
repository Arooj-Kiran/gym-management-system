import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (PostgreSQL `citext` extension), used for emails. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
