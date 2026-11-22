import { InvalidInput, Unavailable } from '@on.auto/operations';
import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import type { CheckJob, CheckOutcome, ProgramPool } from '@on.auto/workflow-engine/dsl';
import { threadPool } from '@on.auto/workflow-engine/thread-pool';
import { Cause, Effect, Exit, type Schema } from 'effect';
import ts from 'typescript6';
import { afterAll, describe, expect, it } from 'vitest';

import { keptLibOnDisk, measuredPoolSettings } from '../testing/read-on-disk.ts';
import { checkingWithin, checkingWithoutADeadline, checksAwaitedAtMostMs } from '../testing/time/patient-checks.ts';
import { fewerAssignments, mostAssignmentsInAFunction } from './assignment-bound.ts';
import * as checkWorkerModule from './check-worker.ts';
import { checkerOf } from './checking.ts';
import { sandboxLibFrom } from './kept-lib.ts';
import { checkDeadlineMs, checkedAtSave, checkWorker } from './save-check.ts';
import { strippedExpression, strippedModule } from './type-stripping.ts';

const pool = threadPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

const patient = checkingWithoutADeadline(pool);

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

function scriptedPool(answers: readonly ('busy' | 'memory' | 'checked')[]): ProgramPool {
  const left = [...answers];
  const next = (): CheckOutcome => {
    const answer = left.shift() ?? 'checked';
    return answer === 'checked'
      ? { ran: 'checked', issues: [], milliseconds: 1 }
      : { ran: 'stopped', because: answer, milliseconds: 1 };
  };
  return { ...pool, check: () => Promise.resolve(next()) };
}

function refusalOf(scripted: ProgramPool): Effect.Effect<unknown> {
  return checkedAtSave(scripted, job).pipe(
    Effect.map((): unknown => 'saved'),
    Effect.catchTag('unavailable', (refused: Pick<Unavailable, 'kind' | 'retry_after'>) =>
      Effect.succeed<unknown>(refused.kind === 'busy' ? refused.retry_after : 'unavailable'),
    ),
    Effect.orElseSucceed((): unknown => 'refused'),
  );
}

function takingMs(takesMs: number, asked: (deadlineMs: number) => void): ProgramPool {
  return {
    ...pool,
    check: (request) => {
      asked(request.deadlineMs);
      return Promise.resolve<CheckOutcome>(
        takesMs > request.deadlineMs
          ? { ran: 'stopped', because: 'deadline', milliseconds: request.deadlineMs }
          : { ran: 'checked', issues: [], milliseconds: takesMs },
      );
    },
  };
}

function checked(on: ProgramPool, deadlineMs?: number) {
  return Effect.runPromiseExit(checkedAtSave(on, job, deadlineMs));
}

async function endingOf(on: ProgramPool, deadlineMs: number): Promise<string> {
  const exit = await checked(on, deadlineMs);
  if (Exit.isSuccess(exit)) {
    return 'answered';
  }
  return Cause.squash(exit.cause) instanceof InvalidInput ? 'refused as invalid input' : 'otherwise';
}

const check = checkerOf(sandboxLibFrom(keptLibOnDisk));

const output: Schema.JsonObject = {
  type: 'object',
  required: ['total'],
  properties: { total: { type: 'number' } },
};

function assigning(times: number, helper = ''): string {
  return [
    'export default function (input: Input): Output {',
    helper,
    '  let total = 0;',
    ...Array.from({ length: times }, (_, index) => (index % 2 === 0 ? `  total += ${index};` : '  total++;')),
    '  return { total };',
    '}',
  ].join('\n');
}

function issuesOf(jobAssignmentBound: CheckJob): readonly (readonly [number | 'module', number, string])[] {
  const answer = check(jobAssignmentBound);
  return answer.ran === 'checked' ? answer.issues.map(({ at, line, detail }) => [at, line, detail] as const) : [];
}

function computation(source: string): CheckJob {
  return { module: { place: 'computation', source }, schemas: { output }, expressions: [] };
}

function fileOf(source: string): ts.SourceFile {
  return ts.createSourceFile('/program.ts', source, ts.ScriptTarget.ES2025, true);
}

describe('save check', () => {
  afterAll(() => pool.close());

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
      expect(checkWorker().pathname).toMatch(/\/program-check\/check-worker\.ts$/u);
      expect(Object.keys(checkWorkerModule)).toEqual([]);
    });

    it('is named, with the roots of the files it is handed, by modules that load where import.meta.url names no file', async () => {
      const saveCheck = await importedWithoutAnAddress(new URL('./save-check.ts', import.meta.url));
      const keptLib = await importedWithoutAnAddress(new URL('./kept-lib.ts', import.meta.url));

      expect([Object.keys(saveCheck), Object.keys(keptLib)]).toEqual([
        [
          'checkDeadlineMs',
          'checkShippedRoots',
          'checkWorker',
          'checkedAtSave',
          'handedWorkersWithChecks',
          'keptLibOf',
        ],
        ['definitionsPackage', 'definitionsShippedRoots', 'keptLibFiles', 'sandboxLibFrom'],
      ]);
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
        (['memory', 'cancelled', 'closing'] as const).map((because) =>
          checked(answering({ ran: 'stopped', because, milliseconds: 1 })),
        ),
      );

      expect(stopped).toEqual(
        [
          'The check of the document took more memory than its worker may use, and was stopped; try again',
          'The save was stopped before its check ended',
          'The server is stopping',
        ].map((detail) => Exit.fail(new Unavailable({ detail }))),
      );
    });

    it.each([
      { answers: ['busy'], refused: [1] },
      { answers: ['busy', 'busy', 'busy', 'busy', 'busy'], refused: [1, 2, 4, 8, 8] },
      { answers: ['busy', 'busy', 'checked', 'busy'], refused: [1, 2, 'saved', 1] },
      { answers: ['busy', 'memory', 'busy'], refused: [1, 'unavailable', 1] },
    ] as const)(
      'is refused as busy, with a wait that doubles on each refusal in a row, when no checker is ready: $answers',
      async ({ answers, refused }) => {
        const scripted = scriptedPool(answers);
        expect(await Effect.runPromise(Effect.forEach(answers, () => refusalOf(scripted)))).toEqual(refused);
      },
    );

    it.each([
      [1, 2],
      [2000, 2001],
      [30_000, 30_001],
    ])(
      'is refused as invalid input, with the deadline it was given, when it would take longer than its %i ms, and answered when it takes them',
      async (deadlineMs, longerMs) => {
        const asked: number[] = [];
        const record = (handed: number) => {
          asked.push(handed);
        };

        const endings = await Promise.all([
          endingOf(takingMs(longerMs, record), deadlineMs),
          endingOf(takingMs(deadlineMs, record), deadlineMs),
        ]);

        expect(endings).toEqual(['refused as invalid input', 'answered']);
        expect(asked).toEqual([deadlineMs, deadlineMs]);
      },
    );

    it('allows a save 2 s of the pool’s clock, and a test’s patient check 30 s or no deadline at all', async () => {
      const handed: number[] = [];
      const recording: ProgramPool = {
        ...pool,
        check: (request) => {
          handed.push(request.deadlineMs);
          return Promise.resolve<CheckOutcome>({ ran: 'checked', issues: [], milliseconds: 1 });
        },
      };

      await Promise.all([
        checked(recording),
        checked(checkingWithin(recording)),
        checked(checkingWithoutADeadline(recording)),
      ]);

      expect([checkDeadlineMs, checksAwaitedAtMostMs, handed]).toEqual([
        2000,
        30_000,
        [2000, 30_000, Number.POSITIVE_INFINITY],
      ]);
    });

    it.each(brokenWhen)('breaks down when the pool answers %j', async (outcome, defect) => {
      const exit = await checked(answering(outcome));

      expect(Exit.hasDies(exit)).toBe(true);
      expect(String(Exit.findDefect(exit))).toContain(defect);
    });
  });
});

describe('the assignments of one function', () => {
  it('are refused past 500, at the first past it, before the compiler analyses them', () => {
    expect(mostAssignmentsInAFunction).toBe(500);
    expect(issuesOf(computation(assigning(500)))).toEqual([]);
    expect(issuesOf(computation(assigning(501)))).toEqual([['module', 504, fewerAssignments]]);
    expect(issuesOf(computation(assigning(2150)))).toEqual([['module', 504, fewerAssignments]]);
  });

  it('are counted in each function apart, a nested one with its own', () => {
    const helper = `  const step = (): number => {\n    let kept = 0;\n${'    kept += 1;\n'.repeat(400)}    return kept;\n  };`;

    expect(issuesOf(computation(assigning(400, helper)))).toEqual([]);
  });

  it('of an expression are refused the same way, with no other expression of the document analysed', () => {
    const many = `(() => {\n  let total = 0;\n${'  total += $data.n;\n'.repeat(501)}  return total;\n})()`;

    expect(
      issuesOf({
        schemas: {},
        expressions: [
          { source: many, names: ['$data'] },
          { source: '$nope', names: ['$data'] },
        ],
      }),
    ).toEqual([[0, 503, fewerAssignments]]);
  });
});

describe('stripping the types of a program the check passed', () => {
  it('blanks its types where they stood, so every line and column stays where it was written', () => {
    const source =
      'type Reply = { text: string };\nexport function answer(input: Reply): string {\n  return input.text as string;\n}';

    const javascript = strippedModule(() => fileOf(source));

    expect(javascript).toBe(
      '                              \nexport function answer(input       )         {\n  return input.text          ;\n}',
    );
    expect(javascript.split('\n').map((line) => line.length)).toEqual(source.split('\n').map((line) => line.length));
  });

  it('strips the body of an expression alone, keeping its lines', () => {
    expect(strippedExpression('$data.total as number')).toBe('$data.total          ');
    expect(strippedExpression('[\n  $data.total as number,\n]')).toBe('[\n  $data.total          ,\n]');
    expect(strippedExpression(' $data.total ')).toBe(' $data.total ');
  });
});
