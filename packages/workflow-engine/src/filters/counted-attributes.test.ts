import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { literalFilterOf } from './event-filter.ts';

const at = '/schedule/on';

const countedFromOne =
  'is a whole number from 1, written out; a run no reaction started carries no depth and a run no call started no calldepth, so a filter for such runs leaves the attribute out';

function rejectionsOf(filter: JsonObject): readonly { readonly pointer: string; readonly detail: string }[] {
  const reading = literalFilterOf(filter, at);
  return 'rejections' in reading ? reading.rejections : [];
}

describe('an event filter that names the attributes of the context', () => {
  it('is refused when it names an attribute as CloudEvents names none, and a count that is not a whole number', () => {
    expect(
      rejectionsOf({
        with: { type: 'com.acme.ledger.month-closed', 'tenant/id': 'acme', depth: 'two', calldepth: 1.5 },
      }),
    ).toEqual([
      {
        pointer: `${at}/with/tenant~1id`,
        detail:
          'An event filter names an attribute of the event as CloudEvents names it, in at most 20 lowercase letters and digits, not tenant/id',
        forbidden: true,
      },
      { pointer: `${at}/with/depth`, detail: `depth ${countedFromOne}`, forbidden: false },
      { pointer: `${at}/with/calldepth`, detail: `calldepth ${countedFromOne}`, forbidden: false },
    ]);
  });

  it('takes any attribute of the context written out, and a whole number for a depth or a version', () => {
    expect(
      rejectionsOf({
        with: { type: 'run_succeeded', triggerkind: 'event', caller: 'acme-admin', depth: 2, definitionversion: 1 },
      }),
    ).toEqual([]);
  });

  it('is refused for a count of 0, which no event carries, in words that say to leave the attribute out', () => {
    expect(
      rejectionsOf({ with: { type: 'run_succeeded', depth: 0, calldepth: 0, definitionversion: 0 } }).map(
        ({ pointer, detail }) => [pointer, detail],
      ),
    ).toEqual([
      [`${at}/with/depth`, `depth ${countedFromOne}`],
      [`${at}/with/calldepth`, `calldepth ${countedFromOne}`],
      [`${at}/with/definitionversion`, `definitionversion ${countedFromOne}`],
    ]);
  });

  it('takes 1, the least count an event carries', () => {
    expect(rejectionsOf({ with: { type: 'run_succeeded', depth: 1, calldepth: 1, definitionversion: 1 } })).toEqual([]);
  });
});
