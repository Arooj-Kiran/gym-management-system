import {
  canViewReport,
  REPORT_LABELS,
  resolveReportRange,
  type ReportDto,
  type ReportInterval,
  type ReportRange,
  type ReportType,
  type Role,
} from '@gms/shared';
import { forbidden, validationFailed } from '../../lib/errors';
import { gymToday } from '../../lib/dates';
import { toCsv } from './csv';
import { FINANCIAL_REPORTS } from './financial-reports';
import { OPERATIONAL_REPORTS } from './operational-reports';
import type { ReportBuilder } from './report-sql';

const BUILDERS = { ...OPERATIONAL_REPORTS, ...FINANCIAL_REPORTS } as Record<
  ReportType,
  ReportBuilder
>;

/** The period with its defaults filled in; an invalid one is a 400 on the field at fault. */
export function periodOf(query: { from?: string; to?: string; interval?: ReportInterval }) {
  const result = resolveReportRange(query, gymToday());
  if (!result.ok) throw validationFailed([{ path: result.path, message: result.message }]);
  return result.range;
}

/**
 * The permission the report type needs (operational or financial), with the Receptionist's
 * LIMITED scope: attendance and denied access only (PLAN §5).
 */
export function assertCanView(role: Role, type: ReportType) {
  if (!canViewReport(role, type)) throw forbidden();
}

export async function runReport(role: Role, type: ReportType, range: ReportRange) {
  assertCanView(role, type);
  const content = await BUILDERS[type](range, gymToday());
  const dto: ReportDto = {
    type,
    title: REPORT_LABELS[type],
    from: range.from,
    to: range.to,
    interval: range.interval,
    generatedAt: new Date().toISOString(),
    ...content,
    truncated: content.totalRows > content.rows.length,
  };
  return dto;
}

export function reportCsv(report: ReportDto) {
  return {
    filename: `${report.type}_${report.from}_${report.to}.csv`,
    body: toCsv(report.columns, report.rows),
  };
}
