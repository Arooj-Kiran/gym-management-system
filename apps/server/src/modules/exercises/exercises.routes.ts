import {
  createExerciseSchema,
  exerciseListQuerySchema,
  idParamSchema,
  updateExerciseSchema,
} from '@gms/shared';
import { Router, type Request } from 'express';
import { requestContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { singleImage, type UploadedImage } from '../../middleware/upload';
import { parseInput } from '../../middleware/validate';
import { sendImage } from '../members/members.controller';
import * as exercises from './exercises.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** /exercises — the exercise library (PLAN §4.8). Members see exercises through their plans. */
export function exercisesRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('exercises:read'), async (req, res) => {
    res.json(await exercises.listExercises(parseInput(exerciseListQuerySchema, req.query)));
  });
  router.get('/:id', requirePermission('exercises:read'), async (req, res) => {
    res.json(await exercises.getExercise(idOf(req)));
  });
  router.get('/:id/image', requirePermission('exercises:read'), async (req, res) => {
    sendImage(res, await exercises.readExerciseImage(idOf(req)));
  });
  router.post('/', requirePermission('exercises:manage'), async (req, res) => {
    const input = parseInput(createExerciseSchema, req.body);
    res.status(201).json(await exercises.createExercise(input, requestContext(req)));
  });
  router.patch('/:id', requirePermission('exercises:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateExerciseSchema, req.body);
    res.json(await exercises.updateExercise(id, input, requestContext(req)));
  });
  router.post('/:id/archive', requirePermission('exercises:manage'), async (req, res) => {
    res.json(await exercises.archiveExercise(idOf(req), requestContext(req)));
  });
  router.post(
    '/:id/image',
    requirePermission('exercises:manage'),
    ...singleImage('image'),
    async (req, res) => {
      const image = res.locals.image as UploadedImage;
      res.json(await exercises.replaceExerciseImage(idOf(req), image, requestContext(req)));
    },
  );

  return router;
}
