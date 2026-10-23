import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { CsvReader, type CsvRecord } from '../upload/csv-records.ts';

export interface SeriesRows {
  readonly series: string;
  readonly periods: readonly string[];
  readonly values: Readonly<Float64Array>;
  readonly features: Readonly<Float64Array>;
}

export interface SeriesReading {
  readonly features: number;
  readonly keeps?: (series: string) => boolean;
  readonly sees?: (period: string) => void;
}

interface Growing {
  readonly periods: string[];
  readonly values: number[];
  readonly features: number[];
}

interface GrownSeries {
  readonly periods: readonly string[];
  readonly values: readonly number[];
  readonly features: readonly number[];
}

type Grown = Map<string, Growing>;

function cellOf(field: string | undefined): number {
  return field === undefined || field === '' ? Number.NaN : Number(field);
}

function growingOf(grown: Grown, series: string): Growing {
  const known = grown.get(series);
  if (known !== undefined) {
    return known;
  }
  const growing: Growing = { periods: [], values: [], features: [] };
  grown.set(series, growing);
  return growing;
}

function featuresOf(fields: readonly string[], features: number): readonly number[] {
  return Array.from({ length: features }, (_, index) => cellOf(fields[3 + index]));
}

function taken(grown: Grown, records: readonly CsvRecord[], reading: SeriesReading): void {
  const { features, keeps = () => true, sees = () => {} } = reading;
  for (const { line, fields } of records) {
    const [series = ''] = fields;
    if (line > 1) {
      sees(fields[1] ?? '');
      if (keeps(series)) {
        const growing = growingOf(grown, series);
        growing.periods.push(fields[1] ?? '');
        growing.values.push(cellOf(fields[2]));
        growing.features.push(...featuresOf(fields, features));
      }
    }
  }
}

function rowsOf(grown: ReadonlyMap<string, GrownSeries>): readonly SeriesRows[] {
  return Array.from(grown, ([series, { periods, values, features }]: readonly [string, GrownSeries]) => ({
    series,
    periods,
    values: Float64Array.from(values),
    features: Float64Array.from(features),
  }));
}

export function seriesRowsFrom(opened: () => Readable, reading: SeriesReading): Promise<readonly SeriesRows[]> {
  const chunks = opened();
  const reader = new CsvReader();
  const grown: Grown = new Map();
  const { promise, resolve, reject } = Promise.withResolvers<readonly SeriesRows[]>();
  const failed = (error: unknown) => {
    chunks.destroy();
    reject(error);
  };
  chunks
    .setEncoding('utf8')
    .on('data', (chunk: string) => {
      try {
        taken(grown, reader.read(chunk), reading);
      } catch (error) {
        failed(error);
      }
    })
    .on('error', reject)
    .on('end', () => {
      try {
        taken(grown, reader.end(), reading);
        resolve(rowsOf(grown));
      } catch (error) {
        failed(error);
      }
    });
  return promise;
}

export function seriesRowsIn(path: string, reading: SeriesReading): Promise<readonly SeriesRows[]> {
  return seriesRowsFrom(() => createReadStream(path), reading);
}

export function seriesRowsOfStream(
  stream: ReadableStream<Uint8Array>,
  reading: SeriesReading,
): Promise<readonly SeriesRows[]> {
  return seriesRowsFrom(() => Readable.from(stream, { objectMode: false }), reading);
}
