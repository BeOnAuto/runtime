import type { Schema } from 'effect';

import { isTime } from '../shapes/period-forms.ts';
import { itemsOf, recordOf } from '../shapes/shape-values.ts';
import type { ChartInfo } from './chart-info.ts';
import type { ChartKind, ChartRole } from './chart-kinds.ts';
import { plainText } from './chart-tables.ts';

type Json = Schema.Json;

interface RoleFit {
  readonly fits: (cell: Json) => boolean;
  readonly words: string;
}

const anyCell: RoleFit = { fits: () => true, words: 'any cell' };

const number: RoleFit = { fits: (cell) => typeof cell === 'number', words: 'a number' };

const text: RoleFit = { fits: (cell) => typeof cell === 'string', words: 'text' };

const textOrNumber: RoleFit = {
  fits: (cell) => typeof cell === 'string' || typeof cell === 'number',
  words: 'text, a number or a time',
};

const size: RoleFit = { fits: (cell) => typeof cell === 'number' && cell >= 0, words: 'a number of at least 0' };

const time: RoleFit = { fits: (cell) => typeof cell === 'string' && isTime(cell), words: 'a time' };

const placedOnALine: ReadonlySet<string> = new Set(['heatmap', 'timeline']);

function fitOf(kind: ChartKind, role: ChartRole): RoleFit {
  const fits: Readonly<Record<ChartRole, RoleFit>> = {
    x: textOrNumber,
    y: placedOnALine.has(kind.name) ? text : number,
    color: anyCell,
    size,
    value: number,
    low: number,
    high: number,
    mark: text,
    start: time,
    end: time,
  };
  return fits[role];
}

type Placed = { readonly placed: ReadonlyMap<ChartRole, number> } | { readonly why: string };

function placedRoles({ kind, roles }: ChartInfo, columns: readonly string[]): Placed {
  const placed = new Map<ChartRole, number>();
  for (const [role, column] of roles) {
    const index = columns.indexOf(column);
    if (index === -1) {
      return { why: `the table has no column named ${column} for the role ${role}` };
    }
    placed.set(role, index);
  }
  const free = columns.map((_, index) => index).filter((index) => ![...placed.values()].includes(index));
  for (const role of kind.needs.filter((needed) => !placed.has(needed))) {
    const index = free.shift();
    if (index === undefined) {
      return { why: `${kind.noun} needs another column for ${role}` };
    }
    placed.set(role, index);
  }
  return { placed };
}

function isDrawn(kind: ChartKind, placed: ReadonlyMap<ChartRole, number>, row: readonly Json[]): boolean {
  return kind.needs.every((role) => row[Number(placed.get(role))] !== null);
}

function cellWhy(kind: ChartKind, placed: ReadonlyMap<ChartRole, number>, row: readonly Json[]) {
  return [...placed].find(([role, index]: readonly [ChartRole, number]) => {
    const cell = row[index];
    return cell !== undefined && cell !== null && !fitOf(kind, role).fits(cell);
  });
}

export function tableRolesWhy(info: ChartInfo, table: Json): string | undefined {
  const record = recordOf(table);
  const columns = itemsOf(record['columns']).map((column) => plainText(recordOf(column)['name']));
  const placing = placedRoles(info, columns);
  if ('why' in placing) {
    return placing.why;
  }
  const rows = itemsOf(record['rows']).map((row) => itemsOf(row));
  for (const [number_, row] of rows.entries()) {
    const misfit = isDrawn(info.kind, placing.placed, row) ? cellWhy(info.kind, placing.placed, row) : undefined;
    if (misfit !== undefined) {
      const [role, index] = misfit;
      return `${String(columns[index])}, row ${number_ + 1}, must contain ${fitOf(info.kind, role).words} for ${role}`;
    }
  }
  return undefined;
}
