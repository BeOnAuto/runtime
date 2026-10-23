import { InvalidInput, Unavailable } from '@on.auto/operations';
import { programPool, type CheckOutcome, type CheckJob, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Exit } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { measuredPoolSettings } from '../testing/read-on-disk.ts';
import { checkingWithin } from '../testing/time/patient-checks.ts';
import * as checkWorkerModule from './check-worker.ts';
import { checkDeadlineMs, checkedAtSave, checkWorker } from './save-check.ts';

const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

const patient = checkingWithin(pool);

afterAll(() => pool.close());

const job: CheckJob = {
  module: { place: 'computation', source: 'export default function (input: Input): Output {\n  return input.redy;\n}' },
  schemas: { input: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } } },
  expressions: [{ source: '$data.ready', names: ['$data'] }],
};

const brokenWhen: readonly (readonly [CheckOutcome, string])[] = [
  [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
  [{ ran: 'unreadable', milliseconds: 1 }, 'The check worker could not read the check it was given'],
];

function answering(outcome: CheckOutcome): ProgramPool {
  return { ...pool, check: () => Promise.resolve(outcome) };
}

function checked(on: ProgramPool, deadlineMs?: number) {
  return Effect.runPromiseExit(checkedAtSave(on, job, deadlineMs));
}

describe('the check of a document when it is saved', () => {
  it('runs in the pool’s check worker and answers the compiler’s issues', async () => {
    expect(await checked(patient)).toEqual(
      Exit.succeed({
        issues: [
          {
            at: 'module',
            line: 2,
            detail: "Property 'redy' does not exist on type 'Input'. Did you mean 'ready'?",
          },
        ],
      }),
    );
    expect(checkDeadlineMs).toBe(2000);
    expect(checkWorker.pathname).toMatch(/\/program-check\/check-worker\.ts$/u);
    expect(Object.keys(checkWorkerModule)).toEqual([]);
  });
});

describe('a check that passes', () => {
  it('answers the module and the expressions it changed stripped of their types, which a save keeps', async () => {
    const passing: CheckJob = {
      module: {
        place: 'computation',
        source: 'export default function (input: Input): Output {\n  return input.ready;\n}',
      },
      schemas: job.schemas,
      expressions: [
        { source: '$data.ready as boolean', names: ['$data'] },
        { source: '$data.ready', names: ['$data'] },
      ],
    };

    expect(await Effect.runPromise(checkedAtSave(patient, passing))).toEqual({
      stripped: {
        module: 'export default function (input       )         {\n  return input.ready;\n}',
        expressions: { '$data.ready as boolean': '$data.ready           ' },
      },
    });
    expect(
      await Effect.runPromise(checkedAtSave(answering({ ran: 'checked', issues: [], milliseconds: 1 }), job)),
    ).toEqual({ stripped: {} });
  });
});

describe('a check that does not answer', () => {
  it('is invalid input when the check runs past its deadline on a worker that was ready, saying a busy server may also have slowed it', async () => {
    const detail =
      'The document took longer to check than the 1 ms a save allows; simplify its types or split its program. A busy server may also have slowed the check, so saving it again later may succeed';

    expect(await checked(answering({ ran: 'stopped', because: 'deadline', milliseconds: 1 }), 1)).toEqual(
      Exit.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail }] })),
    );
  });

  it('is unavailable, with what stopped it, when the pool stops the check', async () => {
    const stopped = await Promise.all(
      (['busy', 'memory', 'cancelled', 'closing'] as const).map((because) =>
        checked(answering({ ran: 'stopped', because, milliseconds: 1 })),
      ),
    );

    expect(stopped).toEqual(
      [
        'No checker was ready in time for this save, since this server checks one document at a time with one checker; try again',
        'The check of the document took more memory than its worker may use, and was stopped; try again',
        'The save was stopped before its check ended',
        'The server is stopping',
      ].map((detail) => Exit.fail(new Unavailable({ detail }))),
    );
  });

  it.each(brokenWhen)('breaks down when the pool answers %j', async (outcome, defect) => {
    const exit = await checked(answering(outcome));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});
