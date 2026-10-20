import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase, ConfigError, loadConfig } from '../../src/config/env';

const base = {
  NODE_ENV: 'development',
  WEB_ORIGIN: 'http://localhost:5173/',
  DATABASE_URL: 'postgres://app:secret-value@localhost:5432/gym_dev',
  GYM_TIMEZONE: 'Asia/Karachi',
  CURRENCY_CODE: 'PKR',
};

describe('loadConfig', () => {
  it('applies defaults and normalises the web origin', () => {
    const config = loadConfig({ ...base });
    expect(config.port).toBe(4000);
    expect(config.webOrigin).toBe('http://localhost:5173');
    expect(config.sessionIdleMinutes).toBe(60);
    expect(config.cookieSecure).toBe(false);
    expect(config.trustProxy).toBe(false);
  });

  it('forces secure cookies in production', () => {
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(true);
  });

  it('parses a proxy hop count', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });

  it('lists every invalid variable by name without echoing values', () => {
    const run = () =>
      loadConfig({
        ...base,
        DATABASE_URL: 'not-a-url-secret-value',
        GYM_TIMEZONE: 'Mars/Base',
        CURRENCY_CODE: 'rupees',
      });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('GYM_TIMEZONE');
      expect(message).toContain('CURRENCY_CODE');
      expect(message).not.toContain('not-a-url-secret-value');
    }
  });

  it('applies the access-control defaults', () => {
    const config = loadConfig({ ...base });
    expect(config.accessDuplicateWindowSeconds).toBe(60);
    expect(config.accessDbTimeoutMs).toBe(2000);
    expect(config.accessScanRateLimitPerMinute).toBe(60);
    expect(config.biometricSimulatorEnabled).toBe(false);
  });

  it('allows the simulated scanner outside production', () => {
    expect(
      loadConfig({ ...base, BIOMETRIC_SIMULATOR_ENABLED: 'true' }).biometricSimulatorEnabled,
    ).toBe(true);
  });

  it('refuses to start with the simulated scanner enabled in production (PLAN §6.5)', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', BIOMETRIC_SIMULATOR_ENABLED: 'true' }),
    ).toThrow(/BIOMETRIC_SIMULATOR_ENABLED/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', BIOMETRIC_SIMULATOR_ENABLED: '1' }),
    ).toThrow(ConfigError);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', BIOMETRIC_SIMULATOR_ENABLED: 'false' })
        .biometricSimulatorEnabled,
    ).toBe(false);
  });

  it('requires WEB_ORIGIN', () => {
    const { WEB_ORIGIN: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/WEB_ORIGIN/);
  });

  it('uses TEST_DATABASE_URL in test mode', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://app:x@localhost:5432/gym_test',
    });
    expect(config.databaseUrl).toMatch(/gym_test$/);
  });
});

describe('test database guard', () => {
  const dev = 'postgres://app:x@localhost:5432/gym_dev';

  it('refuses a missing test database URL', () => {
    expect(() => assertSafeTestDatabase(undefined, dev)).toThrow(/not set/);
  });

  it('refuses a database whose name does not end in _test', () => {
    expect(() =>
      assertSafeTestDatabase('postgres://app:x@localhost:5432/gym_dev', undefined),
    ).toThrow(/_test/);
    expect(() => assertSafeTestDatabase('postgres://app:x@localhost:5432/gym', dev)).toThrow(
      /_test/,
    );
  });

  it('refuses the same database as development', () => {
    const same = 'postgres://app:x@localhost:5432/shared_test';
    expect(() => assertSafeTestDatabase(same, same)).toThrow(/different database/);
    expect(() => assertSafeTestDatabase(same, 'postgres://other:y@db:5432/shared_test')).toThrow(
      /different database/,
    );
  });

  it('accepts a separate *_test database', () => {
    expect(() =>
      assertSafeTestDatabase('postgres://app:x@localhost:5432/gym_test', dev),
    ).not.toThrow();
  });

  it('is enforced by loadConfig in test mode', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'test', TEST_DATABASE_URL: base.DATABASE_URL }),
    ).toThrow(ConfigError);
  });
});
