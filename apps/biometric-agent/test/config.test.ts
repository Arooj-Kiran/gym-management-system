import { describe, expect, it } from 'vitest';
import { AgentConfigError, loadAgentConfig } from '../src/config';
import { DEVICE_ID, DEVICE_KEY } from './helpers';

const valid = {
  AGENT_BACKEND_URL: 'http://localhost:4000/api/v1/',
  AGENT_DEVICE_ID: DEVICE_ID,
  AGENT_DEVICE_KEY: DEVICE_KEY,
  AGENT_ADAPTER: 'simulated',
};

describe('loadAgentConfig', () => {
  it('applies the PLAN §7.3 defaults', () => {
    const config = loadAgentConfig(valid);
    expect(config).toMatchObject({
      backendUrl: 'http://localhost:4000/api/v1',
      adapter: 'simulated',
      requestTimeoutMs: 3000,
      heartbeatSeconds: 30,
    });
    expect(config.outboxPath.replaceAll('\\', '/')).toMatch(
      /apps\/biometric-agent\/data\/outbox\.jsonl$/,
    );
  });

  it('rejects the placeholder key and never echoes key values', () => {
    for (const key of ['CHANGE_ME', 'short-secret-value']) {
      const error = (() => {
        try {
          loadAgentConfig({ ...valid, AGENT_DEVICE_KEY: key });
        } catch (caught) {
          return caught as Error;
        }
      })();
      expect(error).toBeInstanceOf(AgentConfigError);
      expect(error!.message).toContain('AGENT_DEVICE_KEY');
      expect(error!.message).not.toContain(key);
    }
  });

  it('accepts only the simulated adapter for now', () => {
    expect(() => loadAgentConfig({ ...valid, AGENT_ADAPTER: 'zkteco' })).toThrow(/simulated/);
  });

  it('requires a device ID and a URL', () => {
    expect(() => loadAgentConfig({ ...valid, AGENT_DEVICE_ID: 'abc' })).toThrow(/AGENT_DEVICE_ID/);
    expect(() => loadAgentConfig({ ...valid, AGENT_BACKEND_URL: 'nope' })).toThrow(
      /AGENT_BACKEND_URL/,
    );
  });
});
