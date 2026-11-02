import {
  createWorkoutAssignmentSchema,
  createWorkoutPlanSchema,
  duplicateWorkoutPlanSchema,
  idParamSchema,
  logWorkoutSchema,
  recordProgressSchema,
  setWorkoutPlanItemsSchema,
  updateWorkoutAssignmentSchema,
  updateWorkoutPlanSchema,
  workoutAssignmentListQuerySchema,
  workoutLogListQuerySchema,
  workoutPlanListQuerySchema,
} from '@gms/shared';
import { Router, type Request, type Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import { sendImage } from '../members/members.controller';
import * as workouts from './workouts.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const auth = (req: Request) => requireAuthContext(req);

/** /workout-plans — plan builder (PLAN §4.8). Trainers read own and assigned members' plans. */
export function workoutPlansRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('workouts:read'));
  router.get('/', async (req, res) => {
    res.json(
      await workouts.listPlans(parseInput(workoutPlanListQuerySchema, req.query), auth(req)),
    );
  });
  router.get('/:id', async (req, res) => {
    res.json(await workouts.getPlan(idOf(req), auth(req)));
  });
  router.post('/', requirePermission('workouts:manage'), async (req, res) => {
    const input = parseInput(createWorkoutPlanSchema, req.body);
    res.status(201).json(await workouts.createPlan(input, auth(req), requestContext(req)));
  });
  router.patch('/:id', requirePermission('workouts:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateWorkoutPlanSchema, req.body);
    res.json(await workouts.updatePlan(id, input, auth(req), requestContext(req)));
  });
  router.put('/:id/items', requirePermission('workouts:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(setWorkoutPlanItemsSchema, req.body);
    res.json(await workouts.setPlanItems(id, input, auth(req), requestContext(req)));
  });
  router.post('/:id/duplicate', requirePermission('workouts:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(duplicateWorkoutPlanSchema, req.body ?? {});
    res.status(201).json(await workouts.duplicatePlan(id, input, auth(req), requestContext(req)));
  });
  router.post('/:id/archive', requirePermission('workouts:manage'), async (req, res) => {
    res.json(await workouts.archivePlan(idOf(req), auth(req), requestContext(req)));
  });
  return router;
}

/** /workout-assignments — plans given to members, with trainer notes. */
export function workoutAssignmentsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('workouts:read'));
  router.get('/', async (req, res) => {
    const query = parseInput(workoutAssignmentListQuerySchema, req.query);
    res.json(await workouts.listAssignments(query, auth(req)));
  });
  router.get('/:id', async (req, res) => {
    res.json(await workouts.getAssignment(idOf(req), auth(req)));
  });
  router.post('/', requirePermission('workouts:assign'), async (req, res) => {
    const input = parseInput(createWorkoutAssignmentSchema, req.body);
    res.status(201).json(await workouts.createAssignment(input, auth(req), requestContext(req)));
  });
  router.patch('/:id', requirePermission('workouts:assign'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateWorkoutAssignmentSchema, req.body);
    res.json(await workouts.updateAssignment(id, input, auth(req), requestContext(req)));
  });
  return router;
}

/** /workout-logs — completion records, written by staff for members in their scope. */
export function workoutLogsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);
  router.get('/', requirePermission('workouts:read'), async (req, res) => {
    res.json(await workouts.listLogs(parseInput(workoutLogListQuerySchema, req.query), auth(req)));
  });
  router.post('/', requirePermission('workouts:log'), async (req, res) => {
    const input = parseInput(logWorkoutSchema, req.body);
    res
      .status(201)
      .json(
        await workouts.logWorkout(input, { kind: 'staff', auth: auth(req) }, requestContext(req)),
      );
  });
  return router;
}

// --- Mounted on /members/:id -----------------------------------------------------------------

/** GET /members/:id/progress */
export async function progressForMember(req: Request, res: Response) {
  res.json(await workouts.listMemberProgress(idOf(req), auth(req)));
}

/** POST /members/:id/progress */
export async function recordProgressForMember(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(recordProgressSchema, req.body);
  res
    .status(201)
    .json(await workouts.recordMemberProgress(id, input, auth(req), requestContext(req)));
}

// --- Mounted on /me --------------------------------------------------------------------------

const userId = (req: Request) => auth(req).user.id;

/** GET /me/workouts */
export async function myWorkouts(req: Request, res: Response) {
  res.json(await workouts.listMyWorkouts(userId(req)));
}

/** GET /me/workout-logs */
export async function myWorkoutLogs(req: Request, res: Response) {
  const query = parseInput(workoutLogListQuerySchema.omit({ memberId: true }), req.query);
  res.json(await workouts.listMyLogs(userId(req), query));
}

/** POST /me/workout-logs */
export async function logMyWorkout(req: Request, res: Response) {
  const input = parseInput(logWorkoutSchema, req.body);
  res.status(201).json(await workouts.logMyWorkout(userId(req), input, requestContext(req)));
}

/** GET /me/progress */
export async function myProgress(req: Request, res: Response) {
  res.json(await workouts.listMyProgress(userId(req)));
}

/** POST /me/progress */
export async function recordMyProgress(req: Request, res: Response) {
  const input = parseInput(recordProgressSchema, req.body);
  res.status(201).json(await workouts.recordMyProgress(userId(req), input, requestContext(req)));
}

/** GET /me/exercises/:id/image */
export async function myExerciseImage(req: Request, res: Response) {
  sendImage(res, await workouts.readMyExerciseImage(userId(req), idOf(req)));
}
