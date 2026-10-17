import { getTableName, sql, type Column, type SQL } from 'drizzle-orm';

/**
 * SQL building blocks shared by the member list, the memberships list, the dashboard and the
 * portal, so "current", "effective status" and "expiring soon" mean the same thing everywhere.
 * They refer to a memberships row through a table alias.
 */

const CURRENT_STATUSES = sql.raw(`('PENDING', 'ACTIVE', 'SUSPENDED')`);

/** An ACTIVE membership whose last day has passed is expired, whether or not the job has run. */
export function effectiveStatusSql(alias: string, today: string): SQL<string> {
  const m = sql.raw(`"${alias}"`);
  return sql<string>`case when ${m}.status = 'ACTIVE' and ${m}.end_date < ${today}::date
    then 'EXPIRED' else ${m}.status::text end`;
}

/**
 * Orders one member's memberships so the first row is the one they are "on":
 * 1. a pending, active or suspended period that has started (the latest one),
 * 2. otherwise the next such period still to come (the earliest one),
 * 3. otherwise the most recent cancelled or expired period.
 */
function currentOrderSql(alias: string, today: string): SQL {
  const m = sql.raw(`"${alias}"`);
  const rank = sql`case when ${m}.status in ${CURRENT_STATUSES} and ${m}.start_date <= ${today}::date then 0
    when ${m}.status in ${CURRENT_STATUSES} then 1 else 2 end`;
  return sql`${rank}, case when ${rank} = 1 then ${m}.start_date end asc,
    ${m}.start_date desc, ${m}.created_at desc`;
}

/**
 * Always table-qualified: Drizzle drops the table name in single-table selects, and an unqualified
 * "id" inside the subquery would bind to the memberships row instead.
 */
const qualified = (column: Column) => sql.raw(`"${getTableName(column.table)}"."${column.name}"`);

/** Scalar subquery: `selection` (written against alias "cm") of the member's current membership. */
export function currentMembershipSql<T>(
  memberId: Column,
  today: string,
  selection: SQL,
): SQL<T | null> {
  return sql<T | null>`(select ${selection} from memberships cm where cm.member_id = ${qualified(memberId)}
    order by ${currentOrderSql('cm', today)} limit 1)`;
}

/** The effective status of the member's current membership, or null if they never had one. */
export const currentEffectiveStatusSql = (memberId: Column, today: string) =>
  currentMembershipSql<string>(memberId, today, effectiveStatusSql('cm', today));

/** The member's current membership as a MembershipBrief-shaped JSON object. */
export const currentMembershipBriefSql = (memberId: Column, today: string) =>
  currentMembershipSql<{
    id: string;
    planName: string;
    status: string;
    effectiveStatus: string;
    startDate: string;
    endDate: string;
  }>(
    memberId,
    today,
    sql`json_build_object('id', cm.id, 'planName', cm.plan_name_snapshot, 'status', cm.status,
      'effectiveStatus', ${effectiveStatusSql('cm', today)},
      'startDate', cm.start_date, 'endDate', cm.end_date)`,
  );

/**
 * Expiring soon: ACTIVE, last day between today and today + N (inclusive), and no pending,
 * active or suspended membership lined up after it (a member who already renewed is not
 * expiring). `alias` names the memberships row being tested.
 */
export function expiringSoonSql(alias: string, today: string, withinDays: number): SQL {
  const m = sql.raw(`"${alias}"`);
  return sql`(${m}.status = 'ACTIVE'
    and ${m}.end_date between ${today}::date and ${today}::date + ${withinDays}::int
    and not exists (
      select 1 from memberships nxt
      where nxt.member_id = ${m}.member_id
        and nxt.status in ${CURRENT_STATUSES}
        and nxt.start_date > ${m}.end_date
    ))`;
}
