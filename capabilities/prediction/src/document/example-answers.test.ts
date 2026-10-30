import { readFileSync } from 'node:fs';

import { shapeNamed } from '@on.auto/definitions/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { weeklyOrders } from '../testing/weekly-orders.ts';
import { parsePredictionDocument } from './document-parsing.ts';

interface FencedBlock {
  readonly language: string;
  readonly body: string;
}

function fencedBlocksOf(page: string): readonly FencedBlock[] {
  const text = readFileSync(new URL(`../../../../docs/${page}`, import.meta.url), 'utf8');
  return [...text.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(([, language = '', body = '']: readonly string[]) => ({
    language,
    body,
  }));
}

function blockOf(blocks: readonly FencedBlock[], language: string, holding: string): string {
  return String(blocks.find((block) => block.language === language && block.body.includes(holding))?.body);
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

function predictsOf(source: string) {
  return Result.getOrThrow(parsePredictionDocument(source)).predicts;
}

function lastRowsOf(rows: string, series: string, count: number): readonly Schema.Json[] {
  const records: readonly (readonly string[])[] = rows
    .trim()
    .split('\n')
    .map((line) => line.split(','));
  return records
    .filter(([name]) => name === series)
    .slice(-count)
    .map(([, at = '', value = '']) => ({ at, value: Number(value) }));
}

describe('the answer to a question on the reference page of prediction functions', () => {
  it('is a series of the example’s grain, with its default history and its horizons', () => {
    const answer = decodeJson(blockOf(fencedBlocksOf('reference/prediction-format.md'), 'json', '"lines"'));
    const predicts = predictsOf(weeklyOrders);

    expect(shapeNamed('series').check(answer)).toEqual([]);
    expect(answer).toMatchObject({
      unit: predicts.unit,
      period: predicts.period,
      lines: [
        { name: 'observed', points: Array.from({ length: predicts.history }, () => ({})) },
        { name: 'predicted', points: predicts.horizons.map(() => ({})) },
      ],
    });
  });
});

describe('the forecast of the developer example', () => {
  it('is a series of the example’s weeks, its observed weeks the last of the data the example uploads', () => {
    const blocks = fencedBlocksOf('tutorials/first-forecast.md');
    const predicts = predictsOf(blockOf(blocks, 'markdown', 'target: signups'));
    const answer = decodeJson(blockOf(blocks, 'json', '"lines"'));
    const observed = lastRowsOf(blockOf(blocks, 'csv', 'series,period,signups'), 'north', predicts.history);

    expect(shapeNamed('series').check(answer)).toEqual([]);
    expect(answer).toMatchObject({
      unit: predicts.unit,
      period: predicts.period,
      origin: '2026-W40',
      lines: [
        { name: 'observed', points: observed },
        { name: 'predicted', points: [{ at: '2026-W41' }] },
      ],
    });
  });
});
