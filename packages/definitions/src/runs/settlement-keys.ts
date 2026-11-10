import { sha256Of } from '@on.auto/content';
import type { Unavailable } from '@on.auto/operations';
import { outputPayloadOf } from '@on.auto/operations/payloads';
import { Result, type Schema } from 'effect';

import {
  comparedPayloads,
  comparedWithoutItsValue,
  type Compared,
  type ValuesRead,
} from '../payloads/payload-comparisons.ts';
import type { RunResult } from './run-commands.ts';

function canonical(value: Schema.Json): Schema.Json {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json) => canonical(item));
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([first]: readonly [string, Schema.Json], [second]: readonly [string, Schema.Json]) =>
        first < second ? -1 : 1,
      )
      .map(([key, item]: readonly [string, Schema.Json]) => [key, canonical(item)]),
  );
}

function digestOf(value: Schema.Json): string {
  return sha256Of(JSON.stringify(canonical(value)));
}

export function canonicallyEqual(recorded: Schema.Json, offered: Schema.Json): boolean {
  return digestOf(recorded) === digestOf(offered);
}

function settlementKeyOf(result: RunResult): string {
  if (result.type === 'run_rejected') {
    const { rejection } = result.data;
    const kind = 'kind' in rejection ? rejection.kind : undefined;
    return JSON.stringify([result.type, rejection.reason, kind ?? null]);
  }
  return JSON.stringify([result.type]);
}

function settlementsCompared(recorded: RunResult | undefined, offered: RunResult, read?: ValuesRead): Compared {
  if (recorded !== undefined && recorded.type === 'run_succeeded' && offered.type === 'run_succeeded') {
    return comparedPayloads(outputPayloadOf(recorded), outputPayloadOf(offered), canonicallyEqual, read);
  }
  return recorded !== undefined && settlementKeyOf(recorded) === settlementKeyOf(offered) ? 'same' : 'different';
}

export function settledTheSame(
  recorded: RunResult | undefined,
  offered: RunResult,
  read?: ValuesRead,
): Result.Result<boolean, Unavailable> {
  const compared = settlementsCompared(recorded, offered, read);
  return compared === 'unknown' ? Result.fail(comparedWithoutItsValue) : Result.succeed(compared === 'same');
}
