import type { MeResponse } from '@gms/shared';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { TestUser } from './factories';

/** App instance for tests: login throttling raised so suites can sign in many times. */
export function testApp(rateLimits = { loginMax: 1_000 }) {
  return createApp({ rateLimits });
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  me: MeResponse;
}

/** Sign in through the real endpoint; the agent keeps the session cookie. */
export async function signIn(
  app: Express,
  user: Pick<TestUser, 'email' | 'password'>,
): Promise<Session> {
  const agent = request.agent(app);
  const login = await agent
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  if (login.status !== 204) throw new Error(`Login failed for ${user.email}: ${login.status}`);
  const me = await agent.get('/api/v1/auth/me');
  return { agent, csrf: me.body.csrfToken, me: me.body };
}
