import { InvalidInput, Unavailable } from '@on.auto/operations';
import type { PoolOutcome } from '@on.auto/workflow-engine/dsl';
import { scriptedPool } from '@on.auto/workflow-engine/testing';
import { Exit, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { computationWith, functionOf, poolOf, programDocument } from '../testing/computation-runs.ts';

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Json, record: Schema.Struct({ work: Schema.Number }) }),
);

const addingOne = programDocument(functionOf('return input + 1;'));

const unavailableWhen: readonly (readonly [PoolOutcome, string])[] = [
  [
    { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
    'No worker was free to run it within 10000 ms; this server runs 4 computation functions at once',
  ],
  [
    { ran: 'stopped', because: 'deadline', milliseconds: 10_000 },
    'The run took longer than the 10000 ms a computation function may run, and was stopped',
  ],
  [
    { ran: 'stopped', because: 'memory', milliseconds: 10 },
    "The run's worker took more than the 256 MiB of heap it may use, and was stopped",
  ],
  [{ ran: 'stopped', because: 'cancelled', milliseconds: 1 }, 'The run was stopped before it ended'],
  [{ ran: 'stopped', because: 'closing', milliseconds: 1 }, 'The server is stopping'],
  [
    {
      ran: 'exhausted',
      limit: 'deadline',
      issue: { detail: 'The program ran past its deadline', line: null },
      work: 5,
      milliseconds: 10_000,
    },
    'The run took longer than the 10000 ms a computation function may run, and was stopped',
  ],
];

const brokenWhen: readonly (readonly [PoolOutcome, string])[] = [
  [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
  [
    { ran: 'refused', issue: { detail: 'SyntaxError: unexpected token', line: 1 }, milliseconds: 1 },
    'The worker refused a program the definition was accepted with: SyntaxError: unexpected token',
  ],
];

describe('a run that the pool stops', () => {
  it.each(unavailableWhen)('is unavailable when the pool answers %j', async (outcome, detail) => {
    const run = computationWith(scriptedPool([outcome], poolOf()));

    expect(await run.running(addingOne, 1)).toEqual(Exit.fail(new Unavailable({ detail })));
  });

  it.each(brokenWhen)('fails, as the server breaks, when the pool answers %j', async (outcome, defect) => {
    const run = computationWith(scriptedPool([outcome], poolOf()));
    const exit = await run.running(addingOne, 1);

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});

describe('a run that was unavailable', () => {
  it('runs when it is tried again, since nothing in it changed', async () => {
    const run = computationWith(scriptedPool([{ ran: 'stopped', because: 'busy', milliseconds: 10_000 }], poolOf()));

    expect(await run.running(addingOne, 1)).toMatchObject(Exit.fail({ _tag: 'unavailable' }));
    expect(await run.running(addingOne, 1)).toMatchObject(Exit.succeed({ output: 2 }));
  });
});

describe('the input of a run', () => {
  it('is checked against the input schema, with a pointer to what does not fit, refused as of the kind input_schema', async () => {
    expect(
      await computationWith().running(campaignPace, {
        period: { days_elapsed: 12, days_total: 31 },
        rows: [{ campaign: 'a', cost_cents: 'ten', budget_cents: 1 }],
      }),
    ).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'rows, then item 1, then cost_cents: expected a whole number, from 0 to 5,000,000.',
          issues: [
            {
              pointer: '/rows/0/cost_cents',
              detail: 'rows, then item 1, then cost_cents: expected a whole number, from 0 to 5,000,000.',
            },
          ],
          kind: 'input_schema',
        }),
      ),
    );
  });

  it('nests at most 512 levels', async () => {
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], null);

    expect(await computationWith().running(programDocument(functionOf('return input;')), deep)).toMatchObject(
      Exit.fail({
        _tag: 'invalid_input',
        detail: 'The input nests more than the 512 levels a computation function takes',
      }),
    );
  });
});

describe('the output of a run', () => {
  it('is the same for the same input, with the same checkpoints, in two pools of workers', async () => {
    const input = campaignRows(300);

    const [first, second] = await Promise.all(
      [poolOf(), poolOf()].map(async (pool) =>
        decodeRun(Option.getOrThrow(Exit.getSuccess(await computationWith(pool).running(campaignPace, input)))),
      ),
    );

    expect(first?.output).toEqual(second?.output);
    expect(first?.record.work).toBe(second?.record.work);
  });

  it('reads the moment the run started as the time of Date', async () => {
    const moment = Date.UTC(2026, 9, 1, 9, 30);
    const reading = programDocument(functionOf('return [Date.now(), new Date().toISOString()];'));

    expect(await computationWith().runningAt(moment, reading, null)).toMatchObject(
      Exit.succeed({ output: [moment, '2026-10-01T09:30:00.000Z'] }),
    );
  });
});
