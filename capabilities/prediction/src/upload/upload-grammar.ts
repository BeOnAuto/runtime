import { Buffer } from 'node:buffer';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { byUtf8 } from '../files/csv-text.ts';
import { grainOfForm, periodForm, periodOfForm, type Grain } from '../periods/grains.ts';
import { CsvFault } from './csv-fault.ts';
import type { CsvRecord } from './csv-records.ts';

export interface UploadedFigures {
  readonly columns: readonly string[];
  readonly rows: number;
  readonly series: number;
  readonly period: Grain;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
}

interface Last {
  readonly series: string;
  readonly period: number;
}

interface Rows {
  readonly grain: Grain | undefined;
  readonly rows: number;
  readonly series: number;
  readonly first: number;
  readonly latest: number;
  readonly last: Last | undefined;
}

const { mostDatasetRows, mostDatasetSeries, mostFeatures, mostSeriesBytes, mostNameCharacters } = predictionBounds;

const columnName = /^[a-z][a-z0-9_]*$/u;

const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

function fieldAt({ fields }: CsvRecord, index: number): string {
  return fields[index] ?? '';
}

function headerOf(record: CsvRecord): readonly string[] {
  const { line, fields } = record;
  const values = fields.slice(2);
  if (fieldAt(record, 0) !== 'series' || fieldAt(record, 1) !== 'period') {
    throw new CsvFault(line, 'The header starts with series,period, then names the target and the features');
  }
  if (values.length === 0 || values.length > mostFeatures + 1) {
    throw new CsvFault(line, `The header names the target and at most ${mostFeatures} features after series,period`);
  }
  const wrong = values.find(
    (name, index) => !columnName.test(name) || name.length > mostNameCharacters || fields.indexOf(name) < index + 2,
  );
  if (wrong !== undefined) {
    throw new CsvFault(
      line,
      `The column ${JSON.stringify(wrong)} is not a name a dataset's column takes, or is named twice: 1 to ${mostNameCharacters} lowercase letters, digits and underscores, starting with a letter`,
    );
  }
  return fields;
}

function grainOf(known: Grain | undefined, { line }: CsvRecord, form: string): Grain {
  const grain = known ?? grainOfForm(form);
  if (grain === undefined) {
    throw new CsvFault(
      line,
      `The period ${JSON.stringify(form)} is not in an ISO 8601 form: YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY-Qn or YYYY`,
    );
  }
  return grain;
}

function periodOf(grain: Grain, { line }: CsvRecord, form: string): number {
  const period = periodOfForm(grain, form);
  if (period === undefined) {
    throw new CsvFault(
      line,
      `The period ${JSON.stringify(form)} is not a ${grain} written as the first row writes one`,
    );
  }
  return period;
}

function seriesOf({ line }: CsvRecord, series: string): string {
  if (series === '' || Buffer.byteLength(series, 'utf8') > mostSeriesBytes) {
    throw new CsvFault(line, `The series is text of 1 to ${mostSeriesBytes} bytes`);
  }
  return series;
}

function valuesChecked({ line, fields }: CsvRecord): void {
  const wrong = fields
    .slice(2)
    .find((value) => value !== '' && !(jsonNumber.test(value) && Number.isFinite(Number(value))));
  if (wrong !== undefined) {
    throw new CsvFault(line, `The value ${JSON.stringify(wrong)} is not a JSON number or empty`);
  }
}

function orderChecked(last: Last | undefined, next: Last, { line }: CsvRecord): boolean {
  if (last === undefined) {
    return true;
  }
  const order = byUtf8(last.series, next.series);
  if (order > 0 || (order === 0 && next.period <= last.period)) {
    throw new CsvFault(
      line,
      'The rows are sorted by series then period, one row a series and period, and this one comes out of order',
    );
  }
  return order < 0;
}

function rowTaken(rows: Rows, record: CsvRecord, columns: readonly string[]): Rows {
  if (record.fields.length !== columns.length) {
    throw new CsvFault(
      record.line,
      `The row has ${figure(record.fields.length)} fields where the header names ${columns.length}`,
    );
  }
  const form = fieldAt(record, 1);
  const grain = grainOf(rows.grain, record, form);
  const next = { series: seriesOf(record, fieldAt(record, 0)), period: periodOf(grain, record, form) };
  valuesChecked(record);
  const newSeries = orderChecked(rows.last, next, record);
  const taken: Rows = {
    grain,
    rows: rows.rows + 1,
    series: rows.series + (newSeries ? 1 : 0),
    first: Math.min(rows.first, next.period),
    latest: Math.max(rows.latest, next.period),
    last: next,
  };
  if (taken.rows > mostDatasetRows || taken.series > mostDatasetSeries) {
    throw new CsvFault(
      record.line,
      `A dataset holds at most ${figure(mostDatasetRows)} rows over at most ${figure(mostDatasetSeries)} series`,
    );
  }
  return taken;
}

export interface UploadGrammar {
  readonly take: (records: readonly CsvRecord[]) => void;
  readonly figures: (lastLine: number) => UploadedFigures;
}

export function uploadGrammar(): UploadGrammar {
  let columns: readonly string[] | undefined;
  let taken: Rows = { grain: undefined, rows: 0, series: 0, first: Infinity, latest: -Infinity, last: undefined };
  return {
    take: (records) => {
      for (const record of records) {
        if (columns === undefined) {
          columns = headerOf(record);
        } else {
          taken = rowTaken(taken, record, columns);
        }
      }
    },
    figures: (lastLine) => {
      const { grain } = taken;
      if (columns === undefined || grain === undefined) {
        throw new CsvFault(
          lastLine,
          'The dataset holds no rows; write its header and then one row a series and period',
        );
      }
      return {
        columns: columns.slice(2),
        rows: taken.rows,
        series: taken.series,
        period: grain,
        firstPeriod: periodForm(grain, taken.first),
        lastPeriod: periodForm(grain, taken.latest),
      };
    },
  };
}
