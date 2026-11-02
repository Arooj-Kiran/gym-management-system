import type { ReportCell, ReportColumn } from '@gms/shared';
import { gymWallClock } from '../../lib/dates';

/** Spreadsheets run a cell that starts with one of these as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text cell as plain text: a formula-like value gets a leading apostrophe. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/**
 * One cell as the spreadsheet should show it: money in major units with two decimals,
 * instants as gym-time "YYYY-MM-DD HH:MM", everything else as is.
 */
export function formatCsvCell(column: ReportColumn, value: ReportCell): string {
  if (value === null) return '';
  switch (column.kind) {
    case 'money':
      return (Number(value) / 100).toFixed(2);
    case 'number':
    case 'percent':
      return String(value);
    case 'datetime': {
      const { date, time } = gymWallClock(new Date(String(value)));
      return `${date} ${time}`;
    }
    case 'date':
      return String(value);
    case 'text':
      return neutralizeFormula(String(value));
  }
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/**
 * RFC 4180 CSV with a header row of column labels and CRLF line ends. The byte-order mark lets
 * Excel read names in any script as UTF-8.
 */
export function toCsv(columns: ReportColumn[], rows: Record<string, ReportCell>[]): string {
  const lines = [
    columns.map((column) => quote(neutralizeFormula(column.label))).join(','),
    ...rows.map((row) =>
      columns.map((column) => quote(formatCsvCell(column, row[column.key] ?? null))).join(','),
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
