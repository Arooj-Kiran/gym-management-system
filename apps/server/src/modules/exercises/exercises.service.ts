import {
  ERROR_CODES,
  type ExerciseDto,
  type Paginated,
  type createExerciseSchema,
  type exerciseListQuerySchema,
  type updateExerciseSchema,
} from '@gms/shared';
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { exercises } from '../../db/schema';
import {
  deleteFile,
  newImageKey,
  readImage,
  saveFile,
} from '../../integrations/storage/local-storage';
import { diffFields, recordAudit } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { memberPhotoUrl } from '../members/members.service';

type CreateExercise = z.output<typeof createExerciseSchema>;
type UpdateExercise = z.output<typeof updateExerciseSchema>;
type ExerciseListQuery = z.output<typeof exerciseListQuerySchema>;
type ExerciseRow = typeof exercises.$inferSelect;

/** Staff fetch images here; members use /me/exercises/:id/image (only for their own plans). */
export const exerciseImageUrl = (id: string, key: string | null, base = '/api/v1/exercises') =>
  memberPhotoUrl(`${base}/${id}/image`, key);

export function toExerciseDto(row: ExerciseRow): ExerciseDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    muscleGroup: row.muscleGroup,
    difficulty: row.difficulty,
    instructions: row.instructions,
    equipmentNeeded: row.equipmentNeeded,
    imageUrl: exerciseImageUrl(row.id, row.imageKey),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function writeError(error: unknown): unknown {
  if (isUniqueViolation(error, 'exercises_name_key')) {
    return conflict(
      ERROR_CODES.DUPLICATE_EXERCISE_NAME,
      'An exercise with this name already exists.',
    );
  }
  return error;
}

async function requireExercise(executor: DbExecutor, id: string, forUpdate = false) {
  const query = executor.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('Exercise');
  return row;
}

// --- Reads --------------------------------------------------------------------------------

export async function listExercises(query: ExerciseListQuery): Promise<Paginated<ExerciseDto>> {
  const conditions: (SQL | undefined)[] = [
    query.includeArchived ? undefined : eq(exercises.isActive, true),
    query.muscleGroup ? eq(exercises.muscleGroup, query.muscleGroup) : undefined,
    query.difficulty ? eq(exercises.difficulty, query.difficulty) : undefined,
    query.q ? sql`${exercises.name}::text ilike ${likePattern(query.q)}` : undefined,
  ];
  const where = and(...conditions);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(exercises)
      .where(where)
      .orderBy(asc(exercises.name))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ count: count() }).from(exercises).where(where),
  ]);
  return paginated(rows.map(toExerciseDto), query.page, query.pageSize, total?.count ?? 0);
}

export async function getExercise(id: string): Promise<ExerciseDto> {
  return toExerciseDto(await requireExercise(db, id));
}

export async function readExerciseImage(id: string) {
  const row = await requireExercise(db, id);
  const image = row.imageKey ? await readImage(row.imageKey) : null;
  if (!image) throw notFound('Image');
  return image;
}

// --- Writes -------------------------------------------------------------------------------

export async function createExercise(
  input: CreateExercise,
  ctx: RequestContext,
): Promise<ExerciseDto> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(exercises)
        .values({ ...input, createdBy: ctx.actorUserId })
        .returning();
      await recordAudit(tx, ctx, {
        action: 'EXERCISE_CREATED',
        entityType: 'EXERCISE',
        entityId: row!.id,
        after: { name: input.name, muscleGroup: input.muscleGroup, difficulty: input.difficulty },
      });
      return toExerciseDto(row!);
    });
  } catch (error) {
    throw writeError(error);
  }
}

export async function updateExercise(
  id: string,
  input: UpdateExercise,
  ctx: RequestContext,
): Promise<ExerciseDto> {
  try {
    return await db.transaction(async (tx) => {
      const current = await requireExercise(tx, id, true);
      const diff = diffFields(current, input);
      if (Object.keys(diff.after).length === 0) return toExerciseDto(current);
      const [row] = await tx
        .update(exercises)
        .set(diff.after as Partial<ExerciseRow>)
        .where(eq(exercises.id, id))
        .returning();
      await recordAudit(tx, ctx, {
        action: 'EXERCISE_UPDATED',
        entityType: 'EXERCISE',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
      return toExerciseDto(row!);
    });
  } catch (error) {
    throw writeError(error);
  }
}

/**
 * Archived exercises leave the library and cannot be added to plans; plans that already use one
 * keep it, so members' history stays intact.
 */
export async function archiveExercise(id: string, ctx: RequestContext): Promise<ExerciseDto> {
  return db.transaction(async (tx) => {
    const current = await requireExercise(tx, id, true);
    if (!current.isActive) return toExerciseDto(current);
    const [row] = await tx
      .update(exercises)
      .set({ isActive: false })
      .where(eq(exercises.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'EXERCISE_ARCHIVED',
      entityType: 'EXERCISE',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });
    return toExerciseDto(row!);
  });
}

export async function replaceExerciseImage(
  id: string,
  image: UploadedImage,
  ctx: RequestContext,
): Promise<ExerciseDto> {
  const key = newImageKey('exercises', image.mime);
  await saveFile(key, image.data);
  let previousKey: string | null = null;
  let updated: ExerciseRow | undefined;
  try {
    await db.transaction(async (tx) => {
      const current = await requireExercise(tx, id, true);
      previousKey = current.imageKey;
      [updated] = await tx
        .update(exercises)
        .set({ imageKey: key })
        .where(eq(exercises.id, id))
        .returning();
      await recordAudit(tx, ctx, {
        action: 'EXERCISE_IMAGE_UPDATED',
        entityType: 'EXERCISE',
        entityId: id,
        before: { image: previousKey ? 'present' : 'none' },
        after: { image: 'replaced', contentType: image.mime, bytes: image.data.length },
      });
    });
  } catch (error) {
    await deleteFile(key);
    throw error;
  }
  if (previousKey) await deleteFile(previousKey);
  return toExerciseDto(updated!);
}
