import type { Json } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { problemsOf } from './schema-problems.ts';
import type { SchemaRefusal } from './specification-schema.ts';

function refusedBy(keyword: string, at: string, pointer: string, rule: Json = null): SchemaRefusal {
  return { keyword, at, pointer, rule, value: undefined };
}

function needs(at: string, pointer: string, value: Json, ...names: readonly string[]): SchemaRefusal {
  return { ...refusedBy('required', `${at}/required`, pointer, names), value };
}

function refusesProperty(at: string, pointer: string): SchemaRefusal {
  return refusedBy('not', `${at}/unevaluatedProperties/not`, pointer, {});
}

function inDocument(...refusals: readonly SchemaRefusal[]) {
  return problemsOf({ base: '', task: false, refusals });
}

function inTask(...refusals: readonly SchemaRefusal[]) {
  return problemsOf({ base: '/do/0/step', task: true, refusals });
}

describe('the problems of a refused value', () => {
  it('say what a value lacks, what it may not have and what it breaks, once each', () => {
    expect(
      inDocument(
        needs('#', '', { document: {} }, 'document', 'do'),
        refusesProperty('#', '/extra'),
        refusedBy('maxProperties', '#/properties/do/items/maxProperties', '/do/0', 1),
        refusedBy('type', '#/properties/use/type', '/use', 'object'),
        refusedBy('type', '#/properties/use/type', '/use', 'object'),
      ),
    ).toEqual([
      { pointer: '', detail: 'It needs do' },
      { pointer: '', detail: 'It has extra, which the DSL does not know here' },
      { pointer: '/do/0', detail: 'It has more properties than the DSL allows here' },
      { pointer: '/use', detail: 'It must be an object' },
    ]);
  });
});

describe('the words of a rule of the DSL', () => {
  it('give the value the schema gives the rule', () => {
    expect(
      inDocument(
        refusedBy('type', '#/properties/a/type', '/a', ['string', 'integer', 'decimal']),
        refusedBy('enum', '#/properties/c/enum', '/c', ['continue', 'exit', 3]),
        refusedBy('pattern', '#/properties/d/pattern', '/d', String.raw`^\s*\$\{.+\}\s*$`),
        refusedBy('format', '#/properties/e/format', '/e', 'uri'),
        refusedBy('minLength', '#/properties/f/minLength', '/f', 1),
        refusedBy('minItems', '#/properties/g/minItems', '/g', 1),
        refusedBy('minProperties', '#/properties/h/minProperties', '/h', 1),
        refusedBy('minimum', '#/properties/i/minimum', '/i', 0),
        refusedBy('maximum', '#/properties/j/maximum', '/j', 65_535),
        refusedBy('multipleOf', '#/properties/k/multipleOf', '/k', 2),
      ),
    ).toEqual([
      { pointer: '/a', detail: 'It must be a string or an integer or "decimal"' },
      { pointer: '/c', detail: 'It must be one of "continue", "exit", 3' },
      { pointer: '/d', detail: String.raw`It must match the pattern "^\s*\$\{.+\}\s*$"` },
      { pointer: '/e', detail: 'It must be in the format "uri"' },
      { pointer: '/f', detail: 'It needs at least 1 characters' },
      { pointer: '/g', detail: 'It needs at least 1 items' },
      { pointer: '/h', detail: 'It needs at least 1 properties' },
      { pointer: '/i', detail: 'It must be at least 0' },
      { pointer: '/j', detail: 'It must be at most 65535' },
      { pointer: '/k', detail: 'It breaks the rule multipleOf the DSL sets here' },
    ]);
  });

  it('name no missing property of a value that is not an object, nor one the schema does not name', () => {
    expect(
      inDocument(needs('#/properties/a', '/a', 3, 'b'), { ...refusedBy('required', '#/required', '', [3]), value: {} }),
    ).toEqual([]);
  });
});

describe('the branches of the DSL a refused value is read in', () => {
  it('leave out those the value does not take, by a constant or a type it does not have', () => {
    expect(
      inTask(
        refusedBy('oneOf', '#/oneOf', ''),
        refusedBy('const', '#/oneOf/0/$ref/properties/call/const', '/call', 'http'),
        needs('#/oneOf/0/$ref/properties/with', '/with', {}, 'method'),
        needs('#/oneOf/1/$ref', '', { call: 3 }, 'set'),
        refusedBy('type', '#/oneOf/1/$ref/properties/if/type', '/if', 'string'),
        refusedBy('minLength', '#/oneOf/2/$ref/properties/call/minLength', '/call', 1),
      ),
    ).toEqual([{ pointer: '/do/0/step/call', detail: 'It needs at least 1 characters' }]);
  });

  it('leave out a property the DSL is said not to know when it is known but wrong, or when no branch was taken', () => {
    expect(
      inTask(
        refusesProperty('#', '/for'),
        needs('#/properties/for', '/for', {}, 'in'),
        refusedBy('oneOf', '#/properties/output/oneOf', '/output'),
        refusesProperty('#/properties/output', '/output/as'),
      ),
    ).toEqual([{ pointer: '/do/0/step/for', detail: 'It needs in' }]);
  });

  it('are the alternatives the value goes furthest into, of each choice and value apart', () => {
    expect(
      inTask(
        refusedBy('oneOf', '#/properties/to/oneOf', '/to'),
        needs('#/properties/to/oneOf/0', '/to', {}, 'all'),
        needs('#/properties/to/oneOf/1/properties/one', '/to/one', {}, 'with'),
        refusedBy('oneOf', '#/properties/list/items/oneOf', '/list/0'),
        refusedBy('type', '#/properties/list/items/oneOf/0/type', '/list/0', 'string'),
        refusedBy('enum', '#/properties/list/items/oneOf/1/enum', '/list/0', ['a']),
        refusedBy('type', '#/properties/list/items/oneOf/0/type', '/list/1', 'string'),
      ),
    ).toEqual([
      { pointer: '/do/0/step/to/one', detail: 'It needs with' },
      { pointer: '/do/0/step/list/0', detail: 'It must be a string' },
      { pointer: '/do/0/step/list/0', detail: 'It must be one of "a"' },
      { pointer: '/do/0/step/list/1', detail: 'It must be a string' },
    ]);
  });
});

describe('a refusal with no problem of its own', () => {
  it('says that a task has no type the DSL knows when every type it could have needs a key it lacks', () => {
    expect(
      inTask(
        refusedBy('oneOf', '#/oneOf', ''),
        needs('#/oneOf/0/$ref', '', {}, 'set'),
        needs('#/oneOf/1/$ref', '', {}, 'wait'),
      ),
    ).toEqual([
      {
        pointer: '/do/0/step',
        detail:
          'The task has no type the DSL knows: a task is one of call, do, emit, for, fork, listen, raise, run, set, switch, try, wait',
      },
    ]);
  });

  it('is in the words of the choice the value takes no branch of, when nothing else is wrong with it', () => {
    expect(inDocument(refusedBy('$ref', '#/$ref', ''), refusedBy('oneOf', '#/$ref/oneOf', ''))).toEqual([
      { pointer: '', detail: 'It does not match exactly one of the alternatives the DSL allows here' },
    ]);
    expect(
      inDocument(
        refusedBy('anyOf', '#/anyOf', '/a'),
        refusedBy('not', '#/properties/b/not', '/b', { enum: [] }),
        refusedBy('const', '#/properties/c/const', '/c', 'http'),
      ),
    ).toEqual([
      { pointer: '/a', detail: 'It matches none of the alternatives the DSL allows here' },
      { pointer: '/b', detail: 'It is a value the DSL does not allow here' },
      { pointer: '/c', detail: 'It must be "http"' },
    ]);
  });
});
