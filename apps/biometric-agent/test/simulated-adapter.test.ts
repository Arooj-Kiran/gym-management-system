import { describe, expect, it } from 'vitest';
import type { ScanEvent } from '../src/adapters/scanner-adapter';
import { SimulatedAdapter } from '../src/adapters/simulated-adapter';

async function started() {
  const adapter = new SimulatedAdapter(() => new Date('2026-10-19T09:00:00.000Z'));
  const events: ScanEvent[] = [];
  await adapter.start((event) => events.push(event));
  return { adapter, events };
}

describe('SimulatedAdapter', () => {
  it('emits a MATCH event with a fresh event ID for a SIM- ID', async () => {
    const { adapter, events } = await started();
    adapter.scan('sim-0001');
    adapter.scan('SIM-0001');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      matchResult: 'MATCH',
      templateRef: 'SIM-0001',
      occurredAt: '2026-10-19T09:00:00.000Z',
    });
    expect(events[0]!.eventId).not.toBe(events[1]!.eventId);
  });

  it('refuses IDs that are not fake SIM- IDs', async () => {
    const { adapter, events } = await started();
    expect(() => adapter.scan('1042')).toThrow(/fake IDs/);
    expect(() => adapter.scan('SIM-1')).toThrow();
    expect(events).toHaveLength(0);
  });

  it('emits NO_MATCH and DEVICE_ERROR events without a template ID', async () => {
    const { adapter, events } = await started();
    adapter.noMatch();
    adapter.fail('SENSOR_DIRTY');
    expect(events.map((event) => [event.matchResult, event.templateRef, event.errorCode])).toEqual([
      ['NO_MATCH', undefined, undefined],
      ['DEVICE_ERROR', undefined, 'SENSOR_DIRTY'],
    ]);
  });

  it('reports DEVICE_ERROR for every scan while unhealthy', async () => {
    const { adapter, events } = await started();
    adapter.setHealth({ health: 'ERROR', errorCode: 'SENSOR_DIRTY' });
    adapter.scan('SIM-0001');
    adapter.noMatch();
    expect(events.every((event) => event.matchResult === 'DEVICE_ERROR')).toBe(true);
    expect(await adapter.health()).toEqual({ health: 'ERROR', errorCode: 'SENSOR_DIRTY' });
  });

  it('hands out free SIM- IDs, never the reserved unenrolled ID, and deletes templates', async () => {
    const { adapter } = await started();
    expect(await adapter.enroll('a')).toBe('SIM-0001');
    expect(await adapter.enroll('b')).toBe('SIM-0002');
    await adapter.deleteTemplate('SIM-0001');
    expect(adapter.hasTemplate('SIM-0001')).toBe(false);
    expect(await adapter.enroll('c')).toBe('SIM-0001');
  });

  it('stops emitting after stop()', async () => {
    const { adapter, events } = await started();
    await adapter.stop();
    adapter.scan('SIM-0001');
    expect(events).toHaveLength(0);
  });
});
