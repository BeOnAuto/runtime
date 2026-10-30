import { Buffer } from 'node:buffer';

import type { PageEvent } from '@on.auto/workflow-host';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { eventTime, valueAt } from '../data/data-pointers.ts';
import { momentOf, periodOfMoment } from '../periods/moments.ts';
import type { DatasetData } from './dataset-data.ts';

export interface Contribution {
  readonly series: string;
  readonly period: number;
  readonly moment: number;
  readonly target: number | undefined;
}

interface Refusal {
  readonly refusal: string;
}

export type EventReading = { readonly contribution: Contribution } | Refusal;

type Read<A> = { readonly value: A } | Refusal;

const { mostSeriesBytes } = predictionBounds;

function timeOf({ time }: DatasetData, { event }: PageEvent): Read<number> {
  const written = time === eventTime ? event.time : valueAt(event.data, time);
  const moment = typeof written === 'string' ? momentOf(written) : undefined;
  if (moment !== undefined) {
    return { value: moment };
  }
  const where = time === eventTime ? 'as an event' : `at ${time}`;
  return {
    refusal: `Its time ${where} is not an ISO 8601 time with its offset, on a day of the calendar from 0000 to 9999 and in no leap second`,
  };
}

function seriesOf({ series }: DatasetData, { event }: PageEvent): Read<string> {
  const named = valueAt(event.data, series);
  if (typeof named === 'string' && named !== '' && Buffer.byteLength(named, 'utf8') <= mostSeriesBytes) {
    return { value: named };
  }
  const where = series === '' ? 'the root of its data' : series;
  return { refusal: `Its series at ${where} is not text of 1 to ${mostSeriesBytes} bytes` };
}

function targetOf({ target: { of } }: DatasetData, { event }: PageEvent): Read<number | undefined> {
  const found = of === undefined ? undefined : valueAt(event.data, of);
  if (found === undefined || found === null) {
    return { value: undefined };
  }
  return typeof found === 'number' && Number.isFinite(found)
    ? { value: found }
    : { refusal: `Its target at ${String(of)} is not a finite number` };
}

export function eventReadingOf(data: DatasetData, placed: PageEvent): EventReading {
  const time = timeOf(data, placed);
  if ('refusal' in time) {
    return time;
  }
  const series = seriesOf(data, placed);
  if ('refusal' in series) {
    return series;
  }
  const target = targetOf(data, placed);
  return 'refusal' in target
    ? target
    : {
        contribution: {
          series: series.value,
          moment: time.value,
          period: periodOfMoment(data.period, time.value),
          target: target.value,
        },
      };
}
