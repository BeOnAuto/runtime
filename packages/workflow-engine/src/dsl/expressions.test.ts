import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { mostEventBytes } from '../machine/limits.ts';
import { expressionUnitOf, type ExpressionUnit } from '../programs/expression-units.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { enclosedBody, expressionSource, runExpression } from './expressions.ts';
import type { Json } from './json.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const budget = { now, mostWork: 250, deadlineAt: Number.POSITIVE_INFINITY };

async function unitOf(clock: () => number = () => 0): Promise<ExpressionUnit> {
  const instance = await freshInstance(shippedFilesOnDisk, unitMemoryBytes);
  return expressionUnitOf(() => instance, { stackBytes: threadStackBytes, mostAnswerBytes: mostEventBytes, clock });
}

const unit = await unitOf();

function nestedIn(levels: number): Json {
  return levels === 0 ? 0 : [nestedIn(levels - 1)];
}

describe('an expression', () => {
  it('is the body of a string enclosed in ${ }', () => {
    expect(enclosedBody('${ $data.name }')).toBe(' $data.name ');
    expect(enclosedBody('  ${$data.a}  ')).toBe('$data.a');
    expect(enclosedBody('$data.name')).toBeUndefined();
    expect(enclosedBody(3)).toBeUndefined();
    expect(expressionSource('${ $data.a }')).toBe(' $data.a ');
    expect(expressionSource('$data.a')).toBe('$data.a');
  });

  it('runs as TypeScript over $data and the values it is given, and answers its value', () => {
    expect(runExpression(unit, '$data.a + $input.b', { data: { a: 1 }, input: { b: 2 } }, budget)).toEqual({
      value: 3,
      work: 0,
    });
    expect(runExpression(unit, '{ total: $data.length }', { data: [4, 5] }, budget)).toMatchObject({
      value: { total: 2 },
    });
    expect(runExpression(unit, '($data.a) * 2', { data: { a: 4 } }, budget)).toMatchObject({ value: 8 });
  });

  it('answers null for what is undefined, at its top or as a member', () => {
    expect(runExpression(unit, '$data.optional', { data: {} }, budget)).toMatchObject({ value: null });
    expect(runExpression(unit, '({ id: $data.id, note: $data.note })', { data: { id: 1 } }, budget)).toMatchObject({
      value: { id: 1, note: null },
    });
  });

  it('reads as Date.now() the time it is given, never the host clock', () => {
    expect(runExpression(unit, '[Date.now(), new Date().toISOString()]', { data: null }, budget)).toMatchObject({
      value: [now, '2026-10-01T09:00:00.000Z'],
    });
  });

  it('is given only the values it names', () => {
    expect(runExpression(unit, 'typeof $context', { data: null, context: 1 }, budget)).toMatchObject({
      value: 'number',
    });
    expect(runExpression(unit, '$input.who', { data: null, context: 1 }, budget)).toMatchObject({
      problem: "$input.who: ReferenceError: '$input' is not defined",
    });
  });
});

describe('a failing expression', () => {
  it('gives a problem with the error it raised, and its line when it spans several', () => {
    expect(runExpression(unit, '$data.a.b', { data: {} }, budget)).toMatchObject({
      problem: "$data.a.b: TypeError: cannot read property 'b' of undefined",
      exhausted: false,
    });
    expect(runExpression(unit, '[\n  1,\n  $data.a.b,\n]', { data: {} }, budget)).toMatchObject({
      problem: "[\n  1,\n  $data.a.b,\n]: TypeError: cannot read property 'b' of undefined (line 3)",
    });
  });

  it('gives a problem when it answers what JSON cannot carry, or a value deeper than 512 levels', () => {
    expect(runExpression(unit, '0 / 0', { data: null }, budget)).toMatchObject({
      problem: '0 / 0: The answer holds NaN at $, which JSON cannot carry',
      exhausted: false,
    });
    expect(runExpression(unit, '({ at: new Date() })', { data: null }, budget)).toMatchObject({
      problem: '({ at: new Date() }): The answer holds a Date at $.at, which JSON cannot carry',
    });
    expect(
      runExpression(unit, 'Array.from({ length: 512 }).reduce((inner) => [inner], 0)', { data: null }, budget),
    ).toMatchObject({ value: nestedIn(512) });
  });
});

describe('an expression that answers what it may not', () => {
  it('gives a problem when its answer is larger than an event holds', () => {
    expect(runExpression(unit, '"x".repeat(1572865)', { data: null }, budget)).toMatchObject({
      problem: `"x".repeat(1572865): The answer takes more than ${mostEventBytes} bytes as JSON`,
      exhausted: false,
    });
  });

  it('gives a problem when it does not parse, at the last line of the expression when the parser reads past it', () => {
    expect(runExpression(unit, '$data +', { data: null }, budget)).toEqual({
      problem: "$data +: SyntaxError: unexpected token in expression: ')'",
      work: 0,
      exhausted: false,
    });
    expect(runExpression(unit, '[\n  $data +\n]', { data: null }, budget)).toMatchObject({
      problem: "[\n  $data +\n]: SyntaxError: unexpected token in expression: ']' (line 3)",
    });
  });

  it('gives a problem of at most 1000 characters', () => {
    expect(
      runExpression(unit, '(() => { throw new Error("x".repeat(5000)) })()', { data: null }, budget),
    ).toMatchObject({
      problem: `(() => { throw new Error("x".repeat(5000)) })(): Error: ${'x'.repeat(5000)}`.slice(0, 1000).concat('…'),
    });
  });

  it('raises a stack overflow, which the expression may catch, at the same depth every time', () => {
    const recursing = '(() => { const down = (depth) => down(depth + 1); return down(0) })()';
    const caught =
      '(() => { let deepest = 0; const down = (depth) => { deepest = depth; return down(depth + 1) }; try { down(0) } catch { return deepest } return -1 })()';

    expect(runExpression(unit, recursing, { data: null }, budget)).toMatchObject({
      problem: `${recursing}: InternalError: stack overflow`,
      exhausted: false,
    });
    expect(runExpression(unit, caught, { data: null }, budget)).toEqual(
      runExpression(unit, caught, { data: null }, budget),
    );
  });
});

describe('an expression that runs out of what it may use', () => {
  it('is exhausted by its work, counted in checkpoints', () => {
    expect(runExpression(unit, '(() => { for (;;) {} })()', { data: null }, budget)).toEqual({
      problem: '(() => { for (;;) {} })(): The program did more work than it may',
      work: 251,
      exhausted: true,
      limit: 'work',
    });
  });

  it('is exhausted by the deadline of its clock', async () => {
    const ticking = { at: 0 };
    const late = await unitOf(() => {
      ticking.at += 1000;
      return ticking.at;
    });

    expect(
      runExpression(late, '(() => { for (;;) {} })()', { data: null }, { ...budget, deadlineAt: 2500 }),
    ).toMatchObject({ exhausted: true, limit: 'deadline' });
  });

  it('is exhausted by the memory of its sandbox, and the sandbox answers so after it', async () => {
    const bounded = await unitOf();
    const bomb = '(() => { const kept = []; for (;;) kept.push("y".repeat(1048576) + kept.length) })()';

    expect(runExpression(bounded, bomb, { data: null }, budget)).toMatchObject({ exhausted: true, limit: 'memory' });
    expect(runExpression(bounded, '1', { data: null }, budget)).toMatchObject({ exhausted: true, limit: 'memory' });
  });
});
