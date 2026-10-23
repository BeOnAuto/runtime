import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { moduleRun } from './module-runs.ts';
import type { Evaluation, ProgramRun } from './program-run.ts';
import { threadStackBytes, unitMemoryBytes, workerStackBytes } from './sandbox-bounds.ts';
import { sandboxRuntimeOf, type SandboxSettings, type Settled } from './sandbox-session.ts';

const evaluation: Evaluation = { budget: 1000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings: SandboxSettings = { stackBytes: threadStackBytes, mostAnswerBytes: 1_048_576, clock: () => 0 };

async function ran(
  body: string,
  more: Partial<Evaluation> = {},
  runSettings: SandboxSettings = settings,
): Promise<ProgramRun> {
  const run = moduleRun(await freshInstance(shippedFilesOnDisk, unitMemoryBytes), runSettings, {
    source: `export default function (input) {\n  ${body}\n}`,
    entry: 'default',
    arguments: ['null'],
    evaluation: { ...evaluation, ...more },
  });
  if (run.ran === 'refused') {
    throw new Error(run.issue.detail);
  }
  return run;
}

function keptOf(settled: Settled): number {
  if ('failed' in settled) {
    throw new Error(settled.failed.issue.detail);
  }
  return settled.kept;
}

const branching = [
  'const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));',
  '  const sorted = Array.from({ length: 5000 }, (_, index) => (index * 7919) % 1000).toSorted((a, b) => a - b);',
  '  return [fib(22), sorted[2500]];',
].join('\n');

describe('the work of a program', () => {
  it('is counted in checkpoints, one every 10,000 polls of the engine, the same on every run', async () => {
    const runs = await Promise.all([ran(branching), ran(branching), ran(branching)]);

    expect(runs.map((run) => run.work)).toEqual([runs[0]?.work, runs[0]?.work, runs[0]?.work]);
    expect(runs[0]).toMatchObject({ ran: 'answered', text: '[17711,500]' });
    expect(runs[0]?.work).toBeGreaterThan(10);
  });

  it('ends a program that does more than its budget, which no try catches and no finally resumes', async () => {
    expect(
      await ran(
        'let rounds = 0;\n  for (;;) {\n    try {\n      for (;;) {}\n    } finally {\n      rounds += 1;\n    }\n  }',
        { budget: 5 },
      ),
    ).toEqual({
      ran: 'exhausted',
      limit: 'work',
      issue: { detail: 'The program did more work than it may', line: null },
      work: 6,
    });
  });

  it('interrupts a regular expression that backtracks without end', async () => {
    expect(await ran('return /^(a+)+$/.test("a".repeat(30) + "b");', { budget: 50 })).toMatchObject({
      ran: 'exhausted',
      limit: 'work',
    });
  });
});

describe('the memory of a program', () => {
  it('is bounded by the maximum of its instance, which ends a program that keeps allocating at the same checkpoint every time', async () => {
    const strings = 'const kept = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);';
    const objects = 'const kept = [];\n  for (let index = 0; ; index++) kept.push({ index, text: "w" + index });';

    const [first, second] = [await ran(strings), await ran(strings)];
    const [many, again] = [await ran(objects, { budget: 100_000 }), await ran(objects, { budget: 100_000 })];

    expect(first).toMatchObject({ ran: 'exhausted', limit: 'memory' });
    expect(second).toEqual(first);
    expect(many).toMatchObject({ ran: 'exhausted', limit: 'memory' });
    expect(again).toEqual(many);
  });

  it('ends a program that catches the refusal of its memory, by memory, whether it then goes on or answers', async () => {
    const catching =
      'let caught = "";\n  try {\n    "x".repeat(2 ** 27).length;\n  } catch (error) {\n    caught = String(error);\n  }';

    expect([await ran(`${catching}\n  return caught;`), await ran(`${catching}\n  for (;;) {}`)]).toMatchObject([
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'exhausted', limit: 'memory' },
    ]);
  });
});

describe('the deadline of a program', () => {
  it('ends it at the first checkpoint after the clock passed it', async () => {
    const ticking = { at: 0 };
    const late: SandboxSettings = {
      ...settings,
      clock: () => {
        ticking.at += 100;
        return ticking.at;
      },
    };

    expect(await ran('for (;;) {}', { deadlineAt: 1000 }, late)).toMatchObject({ ran: 'exhausted', limit: 'deadline' });
  });
});

describe('the stack of a program', () => {
  it('overflows at the same depth for the same bound, an error the program may catch', async () => {
    const deepest =
      'let deepest = 0;\n  const down = (depth) => {\n    deepest = depth;\n    return down(depth + 1);\n  };\n  try {\n    down(0);\n  } catch (error) {\n    return [deepest, String(error)];\n  }\n  return -1;';

    const [first, second] = [await ran(deepest), await ran(deepest)];

    expect(first).toEqual(second);
    expect(first).toEqual({ ran: 'answered', text: '[1363,"InternalError: stack overflow"]', work: 0 });
  });

  it('ends a program whose bound is deeper than the stack of the thread it runs on, which then answers no more', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const runtime = sandboxRuntimeOf(instance, { ...settings, stackBytes: workerStackBytes });
    const context = runtime.context();
    const fn = keptOf(
      context.expression(
        '(() => (\n(() => { const down = (depth) => down(depth + 1); return down(0) })()\n))',
        evaluation,
      ),
    );

    expect(context.call({ fn, args: [], form: 'expression' }, evaluation)).toMatchObject({
      ran: 'exhausted',
      limit: 'stack',
    });
    expect(runtime.broken()).toBe(true);
    context.close();
    runtime.close();
  });
});

describe('what a program throws', () => {
  it('is described by its name and message, or as text, with the line it was thrown on', async () => {
    expect(await ran('throw "plain text";')).toMatchObject({
      ran: 'raised',
      issue: { detail: 'plain text', line: null },
    });
    expect(await ran('throw { message: "only a message" };')).toMatchObject({ issue: { detail: 'only a message' } });
    expect(await ran('throw { name: "", message: "unnamed" };')).toMatchObject({ issue: { detail: 'unnamed' } });
    expect(await ran('throw { code: 7 };')).toMatchObject({ issue: { detail: '[object Object]' } });
    expect(await ran('\n  null.field;')).toMatchObject({
      issue: { detail: "TypeError: cannot read property 'field' of null", line: 3 },
    });
  });

  it('is described the same when the program changed the prototypes the description is written with', async () => {
    expect(
      await ran(
        'Object.defineProperty(Object.prototype, "toJSON", { value: () => undefined });\n  String.prototype.slice = () => "";\n  throw new RangeError("kept");',
      ),
    ).toMatchObject({ ran: 'raised', issue: { detail: 'RangeError: kept', line: 4 } });
  });

  it('is described as unreadable when reading it fails or takes more than a little work', async () => {
    expect(await ran('throw { get message() { throw new Error("no") } };')).toMatchObject({
      issue: { detail: 'an error that is not written as text' },
    });
    expect(await ran('throw { get message() { for (;;) {} } };')).toMatchObject({
      issue: { detail: 'an error that could not be read' },
    });
  });
});

describe('a context of the sandbox', () => {
  it('calls a function over the values it parsed, and lets go of what it is told to forget', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const runtime = sandboxRuntimeOf(instance, settings);
    const context = runtime.context();
    const fn = keptOf(context.expression('((value) => (\n[value]\n))', evaluation));
    const value = keptOf(context.parsed('{"a":1}', evaluation));

    const called = context.call({ fn, args: [value], form: 'expression' }, evaluation);
    const again = context.call({ fn, args: ['[{"a":1}]'], form: 'expression' }, evaluation);
    context.forget(value);
    context.close();
    runtime.close();

    expect([called, again]).toEqual([
      { ran: 'answered', text: '[{"a":1}]', work: 0 },
      { ran: 'answered', text: '[[{"a":1}]]', work: 0 },
    ]);
  });

  it('answers no function for an export that is not one, and raises text that is not JSON as an argument', async () => {
    const runtime = sandboxRuntimeOf(await freshInstance(shippedFilesOnDisk, unitMemoryBytes), settings);
    const context = runtime.context();
    const fn = keptOf(context.expression('((value) => (\n[value]\n))', evaluation));
    const unreadable = {
      ran: 'raised',
      issue: { detail: "SyntaxError: unexpected token: 'not'", line: null },
      work: 0,
    };

    expect(context.exported(fn, 'missing')).toBeUndefined();
    expect(context.parsed('not json', evaluation)).toEqual({ failed: unreadable });
    expect(context.call({ fn, args: ['1', 'not json'], form: 'expression' }, evaluation)).toEqual(unreadable);
    context.close();
    runtime.close();
  });
});

describe('a context whose instance breaks', () => {
  it('answers the failure of a program that breaks the instance it runs on, rather than throwing', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, 16_777_216);
    const runtime = sandboxRuntimeOf(instance, settings);
    const context = runtime.context();

    expect(context.parsed(JSON.stringify('x'.repeat(20_000_000)), evaluation)).toMatchObject({
      failed: { ran: 'exhausted', limit: 'memory' },
    });
    expect(
      context.call({ fn: 0, args: [JSON.stringify('x'.repeat(20_000_000))], form: 'module' }, evaluation),
    ).toMatchObject({ ran: 'exhausted', limit: 'memory' });
    context.close();
    runtime.close();
  });

  it('throws what breaks it for another reason, as a defect of the host', async () => {
    const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
    const runtime = sandboxRuntimeOf(instance, settings);
    const context = runtime.context();
    context.close();

    expect(() => context.call({ fn: 0, args: [], form: 'module' }, evaluation)).toThrow('Lifetime not alive');
  });
});
