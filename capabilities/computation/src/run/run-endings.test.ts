import { Conflict, Unavailable } from '@on.auto/operations';
import type { PoolOutcome, ProgramPool, ProgramRequest } from '@on.auto/workflow-engine/dsl';
import { scriptedPool } from '@on.auto/workflow-engine/testing';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { computationWith, functionOf, poolOf, programDocument, type RunBounds } from '../testing/computation-runs.ts';

function unworkable(detail: string): Exit.Exit<never, Conflict> {
  return Exit.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function ended(body: string, frontMatter?: string) {
  return computationWith().running(programDocument(functionOf(body), frontMatter), null);
}

const smallWork = { budget: 50 };

const smallMemory = { memoryBytes: 16_777_216 };

function endedWithin(bounds: RunBounds, body: string) {
  return computationWith(poolOf(), bounds).running(programDocument(functionOf(body)), null);
}

function usedAfter(checkpoints: number, mebibytes = 16): Exit.Exit<never, Conflict> {
  return unworkable(
    `The program used more memory than a run may, the ${mebibytes} MiB of its sandbox, having done ${checkpoints} checkpoints of work`,
  );
}

function reaching(limit: 'work' | 'memory'): PoolOutcome {
  return {
    ran: 'exhausted',
    limit,
    issue: { detail: 'The program reached a bound', line: null },
    work: 7,
    milliseconds: 5,
  };
}

interface RecordingPool {
  readonly pool: ProgramPool;
  readonly asked: () => readonly (readonly [number, number])[];
}

function recordingPool(script: readonly PoolOutcome[]): RecordingPool {
  const scripted = scriptedPool(script, poolOf());
  const asked: ProgramRequest[] = [];
  return {
    pool: {
      ...scripted,
      run: (request, signal) => {
        asked.push(request);
        return scripted.run(request, signal);
      },
    },
    asked: () => asked.map(({ budget, memoryBytes }) => [budget, memoryBytes]),
  };
}

const notJson: readonly (readonly [string, string, string])[] = [
  ['a Date', 'return { at: new Date(0) };', 'a Date at $.at'],
  ['a Map', 'return { kept: new Map() };', 'a Map at $.kept'],
  ['a BigInt', 'return [10n];', 'a bigint at $[0]'],
  ['NaN', 'return { pace: 0 / 0 };', 'NaN at $.pace'],
  ['undefined', 'return { missing: undefined };', 'undefined at $.missing'],
  ['a cycle', 'const kept: any = {};\n  kept.self = kept;\n  return kept;', 'a cycle at $.self'],
];

describe('a run whose program raises', () => {
  it('ends in conflict, unworkable, with the error the program raised and its line in the document', async () => {
    expect(await ended('const rows = [1, 2, 3];\n  throw new Error(`stopped at ${rows.length}`);')).toEqual(
      unworkable('The program raised an error on line 6: Error: stopped at 3'),
    );
    expect(await ended('return input.rows.length;')).toEqual(
      unworkable("The program raised an error on line 5: TypeError: cannot read property 'rows' of null"),
    );
  });

  it('ends in conflict when the stack overflows and the program does not catch it', async () => {
    expect(await ended('const down = (depth: number): number => down(depth + 1);\n  return down(0);')).toEqual(
      unworkable('The program raised an error on line 5: InternalError: stack overflow'),
    );
  });

  it('cuts the text of the error at 1,024 bytes', async () => {
    expect(await ended('throw new Error("x".repeat(30000000));')).toEqual(
      unworkable(`The program raised an error on line 5: Error: ${'x'.repeat(1017)}…`),
    );
    expect(await ended('throw "plain text";')).toEqual(unworkable('The program raised an error: plain text'));
  });
});

describe('a run whose program answers what cannot be its output', () => {
  it.each(notJson)('ends in conflict when its output holds %s, naming where', async (_what, body, where) => {
    expect(await ended(body)).toEqual(
      unworkable(`The program's output is not JSON: The answer holds ${where}, which JSON cannot carry`),
    );
  });

  it.each([600, 100_000])(
    'ends in conflict when its output nests deeper than 512 levels, %i of them',
    async (levels) => {
      expect(
        await ended(
          `let value: unknown = 0;\n  for (let level = 0; level < ${levels}; level++) value = [value];\n  return value;`,
        ),
      ).toEqual(
        unworkable(
          `The program's output is not JSON: ${`The answer holds a value deeper than 512 levels at $${'[0]'.repeat(512)}, which JSON cannot carry`.slice(0, 1024)}…`,
        ),
      );
    },
  );

  it('ends in conflict when its output is not what the output schema allows', async () => {
    expect(
      await ended('return { total: 1 };', 'language: typescript\noutput: {schema: {type: object, required: [rows]}}'),
    ).toEqual(unworkable("The program's output does not match the output schema: /rows: Missing key"));
    expect(await ended('return 1;', 'language: typescript\noutput: {schema: {type: string}}')).toEqual(
      unworkable("The program's output does not match the output schema: the output: Expected string"),
    );
  });

  it('ends in conflict when its output takes more than a run can record', async () => {
    expect(await ended('return "x".repeat(1100000);')).toEqual(
      unworkable("The program's output takes more than the 1048320 bytes as JSON a run can record"),
    );
  });

  it('cuts the pointer of an issue of an output the schema refuses at 1,024 bytes, and keeps what it says', async () => {
    const closed =
      'language: typescript\noutput: {schema: {type: object, properties: {total: {type: integer}}, additionalProperties: false}}';

    expect(await ended('return { ["k".repeat(300000)]: 1 };', closed)).toEqual(
      unworkable(
        `The program's output does not match the output schema: /${'k'.repeat(1023)}…: Expected no excess property`,
      ),
    );
  });
});

describe('a run that reaches a bound of its sandbox', () => {
  it('ends in conflict when it does more work than its budget, whatever a try around it does, before any deadline', async () => {
    const tooMuch = unworkable('The program did more work than a run may, 50 checkpoints, and was stopped');

    expect(await endedWithin(smallWork, 'for (;;) {}')).toEqual(tooMuch);
    expect(await endedWithin(smallWork, 'for (;;) {\n    try {\n      for (;;) {}\n    } catch {}\n  }')).toEqual(
      tooMuch,
    );
    expect(await endedWithin(smallWork, 'return /^(a+)+$/.test("a".repeat(40) + "b");')).toEqual(tooMuch);
  });

  it('ends in conflict when it uses more memory than its sandbox, at the same checkpoint twice, and when it catches the refusal', async () => {
    const strings = 'const kept: string[] = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);';
    const objects =
      'const kept: object[] = [];\n  for (let index = 0; ; index++) kept.push({ index, text: "w" + index });';
    const caught = 'try {\n    return "x".repeat(2 ** 29).length;\n  } catch (error) {\n    return String(error);\n  }';

    const objectsUsedAfter = usedAfter(17);

    expect([await endedWithin(smallMemory, strings), await endedWithin(smallMemory, strings)]).toEqual([
      usedAfter(0),
      usedAfter(0),
    ]);
    expect([await endedWithin(smallMemory, objects), await endedWithin(smallMemory, objects)]).toEqual([
      objectsUsedAfter,
      objectsUsedAfter,
    ]);
    expect(await endedWithin(smallMemory, caught)).toEqual(usedAfter(0));
  });

  it('ends in conflict when the stack of its worker overflows before its own', async () => {
    const overflowing = scriptedPool(
      [
        {
          ran: 'exhausted',
          limit: 'stack',
          issue: { detail: 'The program went deeper', line: null },
          work: 10,
          milliseconds: 5,
        },
      ],
      poolOf(),
    );

    expect(await computationWith(overflowing).running(programDocument(functionOf('return 1;')), null)).toEqual(
      unworkable('The program went deeper than the 1 MiB stack of a run allows'),
    );
  });
});

describe('the bounds a run asks its sandbox for', () => {
  it('are those its host gives, or 20,000 checkpoints and 256 MiB, named when the run reaches them', async () => {
    const byDefault = recordingPool([reaching('work'), reaching('memory')]);
    const given = recordingPool([reaching('work'), reaching('memory')]);
    const program = programDocument(functionOf('return 1;'));
    const runs = computationWith(byDefault.pool);
    const smallRuns = computationWith(given.pool, { budget: 300, memoryBytes: 33_554_432 });

    expect([await runs.running(program, null), await runs.running(program, null)]).toEqual([
      unworkable('The program did more work than a run may, 20000 checkpoints, and was stopped'),
      usedAfter(7, 256),
    ]);
    expect([await smallRuns.running(program, null), await smallRuns.running(program, null)]).toEqual([
      unworkable('The program did more work than a run may, 300 checkpoints, and was stopped'),
      usedAfter(7, 32),
    ]);
    expect([byDefault.asked(), given.asked()]).toEqual([
      [
        [20_000, 268_435_456],
        [20_000, 268_435_456],
      ],
      [
        [300, 33_554_432],
        [300, 33_554_432],
      ],
    ]);
  });
});

describe('a run of a program its save did not strip', () => {
  it('ends in conflict, unworkable, rather than run the author’s TypeScript', async () => {
    expect(await computationWith().runningUnsaved(programDocument(functionOf('return 1;')), null)).toEqual(
      unworkable(
        'The computation function was saved without the program its check strips for the sandbox; update it to save it again',
      ),
    );
  });
});

describe('a run of the server that cannot finish', () => {
  it('is unavailable when it runs past its deadline, though its native work spends few checkpoints', async () => {
    const slow = computationWith(poolOf(), { deadlineMs: 500 });
    const churning = 'const big = ["x".repeat(4000000)];\n  for (;;) JSON.stringify(big);';

    expect(await slow.running(programDocument(functionOf(churning)), null)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The run took longer than the 500 ms a computation function may run, and was stopped',
        }),
      ),
    );
  });
});
