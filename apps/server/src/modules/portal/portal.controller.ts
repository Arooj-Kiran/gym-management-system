import {
  classSessionListQuerySchema,
  idParamSchema,
  myAttendanceQuerySchema,
  myBookingSchema,
  optionalReasonBodySchema,
  updateMyProfileSchema,
} from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { parseInput } from '../../middleware/validate';
import { listMyAttendance } from '../attendance/attendance.service';
import { sendImage } from '../members/members.controller';
import * as schedule from './portal-schedule.service';
import * as portalService from './portal.service';

const userId = (req: Request) => requireAuthContext(req).user.id;

export async function getProfile(req: Request, res: Response) {
  res.json(await portalService.getMyProfile(userId(req)));
}

export async function updateProfile(req: Request, res: Response) {
  const input = parseInput(updateMyProfileSchema, req.body);
  res.json(await portalService.updateMyProfile(userId(req), input, requestContext(req)));
}

export async function uploadPhoto(req: Request, res: Response) {
  const image = res.locals.image as UploadedImage;
  res.json(await portalService.replaceMyPhoto(userId(req), image, requestContext(req)));
}

export async function getPhoto(req: Request, res: Response) {
  sendImage(res, await portalService.readMyPhoto(userId(req)));
}

export async function getMembership(req: Request, res: Response) {
  res.json(await portalService.getMyMembership(userId(req)));
}

export async function listMemberships(req: Request, res: Response) {
  res.json({ data: await portalService.getMyMemberships(userId(req)) });
}

export async function listAttendance(req: Request, res: Response) {
  const { page, pageSize } = parseInput(myAttendanceQuerySchema, req.query);
  res.json(await listMyAttendance(userId(req), page, pageSize));
}

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

export async function listTrainers(req: Request, res: Response) {
  res.json({ data: await schedule.myTrainers(userId(req)) });
}

export async function getSchedule(req: Request, res: Response) {
  res.json({ data: await schedule.mySchedule(userId(req)) });
}

export async function listClassSessions(req: Request, res: Response) {
  const query = parseInput(classSessionListQuerySchema, req.query);
  res.json({ data: await schedule.myClassSessions(userId(req), query) });
}

export async function bookClass(req: Request, res: Response) {
  const { sessionId } = parseInput(myBookingSchema, req.body);
  res.status(201).json(await schedule.bookMyClass(userId(req), sessionId, requestContext(req)));
}

export async function cancelBooking(req: Request, res: Response) {
  res.json(await schedule.cancelMyBooking(userId(req), idOf(req), requestContext(req)));
}

export async function listAppointments(req: Request, res: Response) {
  res.json({ data: await schedule.myAppointments(userId(req)) });
}

export async function cancelAppointment(req: Request, res: Response) {
  const id = idOf(req);
  const { reason } = parseInput(optionalReasonBodySchema, req.body ?? {});
  res.json(await schedule.cancelMyAppointment(userId(req), id, reason, requestContext(req)));
}
