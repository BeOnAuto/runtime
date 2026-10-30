import { Buffer } from 'node:buffer';

import type { ReadStatement } from '@on.auto/workflow-host';
import { Array, Effect } from 'effect';

import type { DatasetData } from '../dataset/dataset-data.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { cellOf } from '../dataset/row-measures.ts';
import { periodForm } from '../periods/grains.ts';
import { cellText, fieldOf, recordOf } from './csv-text.ts';
import { periodsOfSeries, type KeptPeriod, type WindowSpan } from './window-reads.ts';

export interface CsvPlan {
  readonly read: ReadStatement;
  readonly row: DatasetRow;
  readonly header: readonly string[];
  readonly series: readonly string[];
  readonly span: WindowSpan;
  readonly mostBytes: number;
}

export class DatasetTooLarge extends Error {
  readonly bytes: number;

  constructor(bytes: number, mostBytes: number) {
    super(`The rows take more than the ${mostBytes} bytes a dataset may as CSV`);
    this.bytes = bytes;
  }
}

function cellsOf(data: DatasetData, kept: KeptPeriod | undefined): readonly string[] {
  if (kept === undefined) {
    return [cellOf(undefined, data.target.as), ...data.features.map(({ as }) => cellOf(undefined, as))].map((cell) =>
      cellText(cell),
    );
  }
  return [
    cellOf(kept.target, data.target.as),
    ...Array.zipWith(data.features, kept.features, ({ as }, state) => cellOf(state, as)),
  ].map((cell) => cellText(cell));
}

function seriesText({ row, span }: CsvPlan, series: string, kept: readonly KeptPeriod[]): string {
  const byPeriod = new Map(kept.map((period) => [period.period, period]));
  const field = fieldOf(series);
  const records: string[] = [];
  for (let period = span.first; period <= span.last; period += 1) {
    records.push(recordOf([field, periodForm(row.data.period, period), ...cellsOf(row.data, byPeriod.get(period))]));
  }
  return records.join('');
}

export function csvStream(plan: CsvPlan): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const state = { next: -1, bytes: 0 };
  const sent = (controller: ReadableStreamDefaultController<Uint8Array>, text: string): void => {
    state.bytes += Buffer.byteLength(text, 'utf8');
    if (state.bytes > plan.mostBytes) {
      controller.error(new DatasetTooLarge(state.bytes, plan.mostBytes));
      return;
    }
    controller.enqueue(encoder.encode(text));
  };
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (state.next === -1) {
        state.next = 0;
        sent(controller, recordOf(plan.header.map((name) => fieldOf(name))));
        return;
      }
      const series = plan.series[state.next];
      if (series === undefined) {
        controller.close();
        return;
      }
      state.next += 1;
      const kept = await Effect.runPromise(periodsOfSeries(plan.read, plan.row, series, plan.span));
      sent(controller, seriesText(plan, series, kept));
    },
  });
}
