import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** PLAN §7.3. Read from the repository .env (or the real environment on the front-desk PC). */

const AGENT_ROOT = path.resolve(import.meta.dirname, '..');
const ROOT_ENV_FILE = path.resolve(AGENT_ROOT, '../../.env');

const configSchema = z.object({
  AGENT_BACKEND_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  AGENT_DEVICE_ID: z.uuid({ error: 'must be the device ID from the Devices screen' }),
  AGENT_DEVICE_KEY: z
    .string()
    .min(32, 'must be the device key from the Devices screen')
    .refine((key) => key !== 'CHANGE_ME', 'must be the device key from the Devices screen'),
  AGENT_ADAPTER: z.enum(['simulated'], {
    error: 'only "simulated" is available until a real scanner is chosen',
  }),
  AGENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3000),
  AGENT_OUTBOX_PATH: z.string().min(1).default('./data/outbox.jsonl'),
  AGENT_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
});

export interface AgentConfig {
  backendUrl: string;
  deviceId: string;
  deviceKey: string;
  adapter: 'simulated';
  requestTimeoutMs: number;
  outboxPath: string;
  heartbeatSeconds: number;
}

export class AgentConfigError extends Error {}

/**
 * Validates the agent settings. Error messages name the variable only, never its value,
 * so the device key cannot leak into a console or log.
 */
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new AgentConfigError(`Invalid agent configuration:\n${problems.join('\n')}`);
  }
  const values = parsed.data;
  return {
    backendUrl: values.AGENT_BACKEND_URL,
    deviceId: values.AGENT_DEVICE_ID,
    deviceKey: values.AGENT_DEVICE_KEY,
    adapter: values.AGENT_ADAPTER,
    requestTimeoutMs: values.AGENT_REQUEST_TIMEOUT_MS,
    outboxPath: path.resolve(AGENT_ROOT, values.AGENT_OUTBOX_PATH),
    heartbeatSeconds: values.AGENT_HEARTBEAT_SECONDS,
  };
}

export function loadEnvFile() {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
}
