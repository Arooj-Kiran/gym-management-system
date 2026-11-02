import { addDays } from '@gms/shared';
import type { Express } from 'express';
import { gymLocalToInstant, gymToday, isoWeekday } from '../../src/lib/dates';
import { signIn, type Session } from './auth';
import { createMember, createMembership, createPlan, createUser } from './factories';

/** A gym-time date `days` from today. */
export const gymDate = (days: number) => addDays(gymToday(), days);

/** The instant of gym wall-clock `time` on the date `days` from today, as ISO. */
export const gymAt = (days: number, time: string) =>
  gymLocalToInstant(gymDate(days), time).toISOString();

/** ISO weekday (Monday = 1) of the gym date `days` from today. */
export const weekdayIn = (days: number) => isoWeekday(gymDate(days));

/** A member with an ACTIVE membership covering well past any date the tests use. */
export async function eligibleMember(overrides: Parameters<typeof createMember>[0] = {}) {
  const member = await createMember(overrides);
  const plan = await createPlan();
  await createMembership(member, plan, { startDate: gymDate(-30), endDate: gymDate(365) });
  return member;
}

/** An eligible member with a portal login, signed in. */
export async function portalMember(app: Express, firstName: string) {
  const email = `${firstName.toLowerCase()}@example.test`;
  const user = await createUser({ role: 'MEMBER', email, firstName, lastName: 'Portal' });
  const member = await eligibleMember({ userId: user.id, email, firstName, lastName: 'Portal' });
  return { user, member, session: await signIn(app, user) };
}

/** JSON calls under /api/v1 with the CSRF header on writes. */
export const api = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
  patch: (path: string, body: object) =>
    s.agent.patch(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
  put: (path: string, body: object) =>
    s.agent.put(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});

/** Every weekday, 06:00–22:00: a trainer who can take appointments at any test time. */
export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startTime: '06:00',
  endTime: '22:00',
}));
