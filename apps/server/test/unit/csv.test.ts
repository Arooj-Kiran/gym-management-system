import type { ReportColumn } from '@gms/shared';
import { describe, expect, it } from 'vitest';
import { gymLocalToInstant } from '../../src/lib/dates';
import { formatCsvCell, neutralizeFormula, toCsv } from '../../src/modules/reports/csv';

const text: ReportColumn = { key: 'member', label: 'Member', kind: 'text' };
const money: ReportColumn = { key: 'amount', label: 'Amount', kind: 'money' };
const when: ReportColumn = { key: 'at', label: 'When', kind: 'datetime' };

describe('report CSV', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    for (const value of ['=1+1', '+92 300', '-5', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    }
    expect(neutralizeFormula('Sana Iqbal')).toBe('Sana Iqbal');
    expect(neutralizeFormula('')).toBe('');
  });

  it('formats money in major units, instants in gym time and null as empty', () => {
    expect(formatCsvCell(money, 123_456)).toBe('1234.56');
    expect(formatCsvCell(money, 5)).toBe('0.05');
    expect(formatCsvCell(money, null)).toBe('');
    // 00:30 in the gym is still the previous day in UTC: the gym-time date is what shows.
    const instant = gymLocalToInstant('2026-03-01', '00:30');
    expect(formatCsvCell(when, instant.toISOString())).toBe('2026-03-01 00:30');
    expect(formatCsvCell({ key: 'n', label: 'N', kind: 'number' }, 0)).toBe('0');
    expect(formatCsvCell({ key: 'd', label: 'D', kind: 'date' }, '2026-03-31')).toBe('2026-03-31');
  });

  it('writes RFC 4180 with a BOM, a header row, quoting and CRLF line ends', () => {
    const csv = toCsv(
      [text, money],
      [
        { member: 'Mirza, "Faisal"', amount: 250_000 },
        { member: '=HYPERLINK("http://example.test")', amount: null },
        { member: 'Line\nbreak', amount: 1 },
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      [
        'Member,Amount',
        '"Mirza, ""Faisal""",2500.00',
        `"'=HYPERLINK(""http://example.test"")",`,
        '"Line\nbreak",0.01',
        '',
      ].join('\r\n'),
    );
  });

  it('writes only the header for an empty report', () => {
    expect(toCsv([text], [])).toBe('\uFEFFMember\r\n');
  });
});
