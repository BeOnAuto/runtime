import { Option, Schema } from 'effect';

import { outputShapeOf } from '../shapes/output-shapes.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import { itemsOf, recordOf } from '../shapes/shape-values.ts';
import { fencesIn, type ChartFence } from './chart-fences.ts';
import { chartInfoOf, type ChartInfo, type ChartInfoReading } from './chart-info.ts';
import { shapeNouns } from './chart-kinds.ts';
import { tableRolesWhy } from './chart-roles.ts';
import { plainText, tableOf } from './chart-tables.ts';

type Json = Schema.Json;

const noDataYet = 'There is no data for this chart yet.';

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const shapeNames: readonly OutputShapeName[] = ['series', 'categories', 'table', 'text'];

function shapeOfData(data: Json, first: readonly OutputShapeName[]): OutputShapeName | undefined {
  return [...first, ...shapeNames].find((name) => outputShapeOf(name).check(data).length === 0);
}

function couldNotBeDrawn(why: string, shown: string): readonly string[] {
  return [`This chart could not be drawn: ${why}.`, '', shown];
}

function shownAsCode(body: string): string {
  return ['```', body, '```'].join('\n');
}

function readsWords(reads: readonly OutputShapeName[]): string {
  return reads.map((name) => shapeNouns[name]).join(' or ');
}

function kindWhy({ kind }: ChartInfo, data: Json): string | undefined {
  if (kind.name === 'calendar') {
    const series = recordOf(data);
    return itemsOf(series['lines']).length === 1 && series['period'] === 'day'
      ? undefined
      : 'a calendar reads a series of one line whose period is day';
  }
  const negative = itemsOf(recordOf(data)['values'])
    .map((value) => recordOf(value))
    .find((value) => Number(value['value']) < 0);
  return kind.name === 'share' && negative !== undefined
    ? `a share chart reads values of at least 0, and ${plainText(negative['name'])} is ${plainText(negative['value'])}`
    : undefined;
}

function shapedWhy(info: ChartInfo, shape: OutputShapeName, data: Json): string | undefined {
  const { kind, roles } = info;
  if (!kind.reads.includes(shape)) {
    return `${kind.noun} reads ${readsWords(kind.reads)}, and this is ${shapeNouns[shape]}`;
  }
  if (shape !== 'table') {
    return roles.size > 0
      ? `its roles name the columns of a table, and this is ${shapeNouns[shape]}`
      : kindWhy(info, data);
  }
  return tableRolesWhy(info, data);
}

function drawn(fence: ChartFence, reading: ChartReading): readonly string[] {
  const parsed = Option.getOrUndefined(decodeJson(fence.body.trim()));
  if (parsed === null) {
    return [noDataYet];
  }
  const reads = 'info' in reading ? reading.info.kind.reads : [];
  const shape = parsed === undefined ? undefined : shapeOfData(parsed, reads);
  if (parsed === undefined || shape === undefined) {
    const why =
      'refused' in reading ? reading.refused : `its data ${parsed === undefined ? 'is not JSON' : 'matches no shape'}`;
    return couldNotBeDrawn(why, shownAsCode(fence.body));
  }
  const why = 'refused' in reading ? reading.refused : shapedWhy(reading.info, shape, parsed);
  return why === undefined ? [] : couldNotBeDrawn(why, tableOf(shape, parsed));
}

type ChartReading = Exclude<ChartInfoReading, { readonly other: true }>;

interface WrittenChart {
  readonly fence: ChartFence;
  readonly reading: ChartReading;
}

export function chartsDrawn(markdown: string): string {
  const lines = markdown.split('\n');
  const charts = fencesIn(lines).flatMap((fence): readonly WrittenChart[] => {
    const reading = chartInfoOf(fence.info);
    return 'other' in reading ? [] : [{ fence, reading }];
  });
  return charts
    .reduceRight((current: readonly string[], { fence, reading }: WrittenChart) => {
      const replaced = drawn(fence, reading);
      return replaced.length === 0
        ? current
        : [...current.slice(0, fence.first), ...replaced, ...current.slice(fence.last + 1)];
    }, lines)
    .join('\n');
}
