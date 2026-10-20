import type {
  AccessDeviceDto,
  AccessDeviceWithKey,
  DeviceHeartbeatResponse,
  createDeviceSchema,
  deviceHeartbeatSchema,
  updateDeviceSchema,
} from '@gms/shared';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { accessDevices, biometricEnrollments } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { randomToken, sha256Hex } from '../../lib/tokens';
import type { AccessDevice } from '../access/device-auth';

type CreateDevice = z.output<typeof createDeviceSchema>;
type UpdateDevice = z.output<typeof updateDeviceSchema>;
type Heartbeat = z.output<typeof deviceHeartbeatSchema>;

export function toDeviceDto(row: AccessDevice): AccessDeviceDto {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    deviceType: row.deviceType,
    status: row.status,
    vendor: row.vendor,
    model: row.model,
    serialNumber: row.serialNumber,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastHealth: row.lastHealth,
    lastErrorCode: row.lastErrorCode,
    keyRotatedAt: row.keyRotatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audit-safe view: no key material, no hash. */
const auditView = (row: AccessDevice) => ({
  name: row.name,
  location: row.location,
  deviceType: row.deviceType,
  vendor: row.vendor,
  model: row.model,
  serialNumber: row.serialNumber,
  status: row.status,
});

/** The secret goes to the caller once; only its SHA-256 is stored. */
function newDeviceKey() {
  const deviceKey = randomToken(32);
  return { deviceKey, apiKeyHash: sha256Hex(deviceKey) };
}

async function lockDevice(tx: DbExecutor, id: string) {
  const [row] = await tx
    .select()
    .from(accessDevices)
    .where(eq(accessDevices.id, id))
    .limit(1)
    .for('update');
  if (!row) throw notFound('Device');
  return row;
}

export async function listDevices(): Promise<AccessDeviceDto[]> {
  const rows = await db.select().from(accessDevices).orderBy(asc(accessDevices.name));
  return rows.map(toDeviceDto);
}

export async function getDevice(id: string): Promise<AccessDeviceDto> {
  const [row] = await db.select().from(accessDevices).where(eq(accessDevices.id, id)).limit(1);
  if (!row) throw notFound('Device');
  return toDeviceDto(row);
}

export async function createDevice(
  input: CreateDevice,
  ctx: RequestContext,
): Promise<AccessDeviceWithKey> {
  const { deviceKey, apiKeyHash } = newDeviceKey();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(accessDevices)
      .values({
        name: input.name,
        location: input.location,
        deviceType: input.deviceType,
        vendor: input.deviceType === 'REAL' ? (input.vendor ?? null) : null,
        model: input.deviceType === 'REAL' ? (input.model ?? null) : null,
        serialNumber: input.deviceType === 'REAL' ? (input.serialNumber ?? null) : null,
        apiKeyHash,
        createdBy: ctx.actorUserId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: 'DEVICE_CREATED',
      entityType: 'ACCESS_DEVICE',
      entityId: row!.id,
      after: auditView(row!),
    });
    return { device: toDeviceDto(row!), deviceKey };
  });
}

export async function updateDevice(
  id: string,
  input: UpdateDevice,
  ctx: RequestContext,
): Promise<AccessDeviceDto> {
  return db.transaction(async (tx) => {
    const current = await lockDevice(tx, id);
    const isReal = current.deviceType === 'REAL';
    const changes = {
      name: input.name,
      location: input.location,
      // Hardware details apply to real scanners only; they stay empty on simulated ones.
      vendor: isReal ? input.vendor : undefined,
      model: isReal ? input.model : undefined,
      serialNumber: isReal ? input.serialNumber : undefined,
    };
    const diff = diffFields(current, changes);
    if (!diff.changed) return toDeviceDto(current);
    const [row] = await tx
      .update(accessDevices)
      .set(diff.after)
      .where(eq(accessDevices.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'DEVICE_UPDATED',
      entityType: 'ACCESS_DEVICE',
      entityId: id,
      before: diff.before,
      after: diff.after,
    });
    return toDeviceDto(row!);
  });
}

export async function rotateDeviceKey(
  id: string,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<AccessDeviceWithKey> {
  const { deviceKey, apiKeyHash } = newDeviceKey();
  return db.transaction(async (tx) => {
    await lockDevice(tx, id);
    const [row] = await tx
      .update(accessDevices)
      .set({ apiKeyHash, keyRotatedAt: new Date() })
      .where(eq(accessDevices.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'DEVICE_KEY_ROTATED',
      entityType: 'ACCESS_DEVICE',
      entityId: id,
      after: { keyRotatedAt: row!.keyRotatedAt },
      reason,
    });
    return { device: toDeviceDto(row!), deviceKey };
  });
}

export async function setDeviceStatus(
  id: string,
  status: 'ACTIVE' | 'DISABLED',
  reason: string | undefined,
  ctx: RequestContext,
): Promise<AccessDeviceDto> {
  return db.transaction(async (tx) => {
    const current = await lockDevice(tx, id);
    if (current.status === status) return toDeviceDto(current);
    const [row] = await tx
      .update(accessDevices)
      .set({ status })
      .where(eq(accessDevices.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: status === 'DISABLED' ? 'DEVICE_DISABLED' : 'DEVICE_ENABLED',
      entityType: 'ACCESS_DEVICE',
      entityId: id,
      before: { status: current.status },
      after: { status },
      reason,
    });
    return toDeviceDto(row!);
  });
}

/**
 * Scanner health from the agent. The reply carries the server time (for clock checks) and the
 * revoked enrollments whose templates the device must delete and then confirm.
 */
export async function recordHeartbeat(
  device: AccessDevice,
  input: Heartbeat,
): Promise<DeviceHeartbeatResponse> {
  await db
    .update(accessDevices)
    .set({
      lastSeenAt: new Date(),
      lastHealth: input.health,
      lastErrorCode: input.health === 'ERROR' ? (input.errorCode ?? null) : null,
    })
    .where(eq(accessDevices.id, device.id));
  const pending = await db
    .select({ enrollmentId: biometricEnrollments.id, templateRef: biometricEnrollments.templateRef })
    .from(biometricEnrollments)
    .where(
      and(
        eq(biometricEnrollments.deviceId, device.id),
        eq(biometricEnrollments.status, 'REVOKED'),
        isNotNull(biometricEnrollments.templateRef),
      ),
    )
    .orderBy(asc(biometricEnrollments.revokedAt));
  return {
    serverTime: new Date().toISOString(),
    pendingDeletions: pending.map((row) => ({
      enrollmentId: row.enrollmentId,
      templateRef: row.templateRef!,
    })),
  };
}
