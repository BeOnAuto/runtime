import type { Json, JsonObject } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { header, workflow } from '../testing/workflows.ts';
import { dslProblems } from './dsl-validation.ts';
import type { Problem } from './schema-problems.ts';

function connected(document: JsonObject): Promise<readonly Problem[]> {
  return dslProblems(document, { connecting: true });
}

function pointersOf(problems: readonly Problem[]): ReadonlySet<string> {
  return new Set(problems.map(({ pointer }) => pointer));
}

const anyWords: unknown = expect.any(String);

function nestedDo(levels: number): string {
  return levels === 1 ? '[{ leaf: { set: { done: true } } }]' : `[{ inner: { do: ${nestedDo(levels - 1)} } }]`;
}

describe('validating a document against the DSL', () => {
  it('finds nothing wrong in a valid workflow, whether or not it connects its steps', async () => {
    const valid = workflow('do:\n  - greet: { set: { a: 1 } }');

    expect(await connected(valid)).toEqual([]);
    expect(await dslProblems(valid, { connecting: false })).toEqual([]);
  });

  it('names the property a task lacks or the DSL does not know, at its place', async () => {
    expect(await connected(workflow('do:\n  - loop: { for: { each: item }, do: [] }'))).toEqual([
      { pointer: '/do/0/loop/for', detail: 'It needs in' },
    ]);
    expect(await connected(workflow('do:\n  - greet: { set: { a: 1 }, bogus: 1 }'))).toEqual([
      { pointer: '/do/0/greet', detail: 'It has bogus, which the DSL does not know here' },
    ]);
  });

  it('says a task has no type the DSL knows instead of listing every type it is not', async () => {
    expect(await connected(workflow('do:\n  - dance: { tango: true }'))).toEqual([
      {
        pointer: '/do/0/dance',
        detail:
          'The task has no type the DSL knows: a task is one of call, do, emit, for, fork, listen, raise, run, set, switch, try, wait',
      },
    ]);
  });
});

describe('the problems the schema finds', () => {
  it('are every problem of the document, not only the first the schema meets', async () => {
    expect(await connected({ document: { dsl: '1.0.3' }, use: 3, do: { not: 'a list' }, input: 3 })).toEqual([
      { pointer: '/document', detail: 'It needs namespace' },
      { pointer: '/document', detail: 'It needs name' },
      { pointer: '/document', detail: 'It needs version' },
      { pointer: '/use', detail: 'It must be an object' },
      { pointer: '/do', detail: 'It must be an array' },
      { pointer: '/input', detail: 'It must be an object' },
    ]);
  });

  it('name what a task lacks beside what is wrong in the tasks it holds', async () => {
    expect(await connected(workflow('do:\n  - guarded: { try: [{ odd: { set: 3 } }] }'))).toEqual([
      { pointer: '/do/0/guarded', detail: 'It needs catch' },
      { pointer: '/do/0/guarded/try/0/odd/set', detail: 'It must be an object' },
      { pointer: '/do/0/guarded/try/0/odd/set', detail: 'It must be a string' },
    ]);
  });

  it('refuse a value of a type the specification does not allow, even where its alternatives would each take it', async () => {
    expect(await connected(workflow('input: { schema: 7 }\ndo: []'))).toEqual([
      { pointer: '/input/schema', detail: 'It must be an object' },
    ]);
    expect(await connected(workflow('schedule: { on: [] }\ndo: []'))).toEqual([
      { pointer: '/schedule/on', detail: 'It must be an object' },
    ]);
  });

  it('assert the formats the schema names, as the SDK did', async () => {
    const source = 'do:\n  - r: { raise: { error: { type: "https://acme.example/e", status: 400, instance: x } } }';

    expect(await connected(workflow(source))).toEqual([
      { pointer: '/do/0/r/raise/error/instance', detail: 'It must be in the format "json-pointer"' },
      { pointer: '/do/0/r/raise/error/instance', detail: String.raw`It must match the pattern "^\s*\$\{.+\}\s*$"` },
    ]);
  });
});

describe('the branches of the DSL a value is read in', () => {
  it('are those of the call a task makes, not of the calls it does not make', async () => {
    expect(await connected(workflow('do:\n  - ask: { call: http, with: { method: get } }'))).toEqual([
      { pointer: '/do/0/ask/with', detail: 'It needs endpoint' },
    ]);
    expect(await connected(workflow('do:\n  - ask: { with: { method: get } }'))).toEqual([
      {
        pointer: '/do/0/ask',
        detail:
          'The task has no type the DSL knows: a task is one of call, do, emit, for, fork, listen, raise, run, set, switch, try, wait',
      },
    ]);
  });

  it('are the alternatives a value goes furthest into', async () => {
    expect(await connected(workflow('do:\n  - await: { listen: { to: { one: {} } } }'))).toEqual([
      { pointer: '/do/0/await/listen/to/one', detail: 'It needs with' },
    ]);
  });
});

describe('a list of tasks', () => {
  it('names one task in each item', async () => {
    expect(await connected(workflow('do:\n  - { a: { set: { x: 1 } }, b: { set: { y: 1 } } }'))).toEqual([
      { pointer: '/do/0', detail: 'It has more properties than the DSL allows here' },
    ]);
  });

  it('is checked once a task, however deep its tasks nest', async () => {
    expect(await connected(workflow(`do: ${nestedDo(30)}`))).toEqual([]);
    expect(
      pointersOf(await connected(workflow(`do: ${nestedDo(30).replace('done: true', 'done: true }, bogus: { x: 1')}`))),
    ).toEqual(new Set([`/do${'/0/inner/do'.repeat(29)}/0/leaf`]));
  });
});

describe('the version of the DSL a document names', () => {
  it('is one of the range the package of the schema of the specification declares', async () => {
    expect(await connected({ document: { ...header, dsl: '1.0.4' }, do: [] })).toEqual([
      {
        pointer: '/document/dsl',
        detail: 'This runtime runs documents of the DSL versions >=1.0.0-0 <=1.0.3, not 1.0.4',
      },
    ]);
    expect(await connected({ document: { ...header, dsl: '1.0.3-alpha' }, do: [] })).toEqual([]);
  });

  it('is left to the schema when the document names none', async () => {
    expect(await connected({ do: [] })).toEqual([{ pointer: '', detail: 'It needs document' }]);
    expect(await connected({ document: { namespace: 'acme', name: 'test', version: '1.0.0' }, do: [] })).toEqual([
      { pointer: '/document', detail: 'It needs dsl' },
    ]);
  });
});

describe('the names in a document', () => {
  it('are well-formed Unicode text, which the places of its problems are written in', async () => {
    expect(await connected(workflow('do:\n  - "\\uD800": { set: { a: 1 } }'))).toEqual([
      { pointer: '/do/0', detail: 'It has a name that is not well-formed Unicode text' },
    ]);
    expect(await connected(workflow('do:\n  - fine: { set: { "\\uDC00": 1 } }'))).toEqual([
      { pointer: '/do/0/fine/set', detail: 'It has a name that is not well-formed Unicode text' },
    ]);
  });
});

describe('the rules of the DSL beyond its schema', () => {
  it('reject a list of tasks with the same name twice', async () => {
    expect(await connected(workflow('do:\n  - a: { set: { x: 1 } }\n  - a: { set: { y: 1 } }'))).toEqual([
      { pointer: '/do', detail: "The following task names are duplicated: 'a'." },
    ]);
    expect(
      await connected(
        workflow(
          'do:\n  - outer:\n      do: [{ b: { set: {x: 1} } }, { c: { set: {x: 1} } }, { b: { set: {x: 1} } }, { c: { set: {x: 1} } }]',
        ),
      ),
    ).toEqual([{ pointer: '/do/0/outer/do', detail: "The following task names are duplicated: 'b', 'c'." }]);
  });

  it('reject steps that do not connect into a graph', async () => {
    expect(await connected(workflow('do:\n  - a: { set: { x: 1 }, then: nowhere }'))).toEqual([
      {
        pointer: '',
        detail: "The steps of the workflow do not connect: Unable to find task to transition to 'nowhere' from 'a'",
      },
    ]);
  });

  it('reject a document that is not JSON at all', async () => {
    const circular: { [key: string]: Json } = { document: header, do: [] };
    circular['self'] = circular;

    expect(await connected(circular)).toEqual([{ pointer: '', detail: expectedCircularity(circular) }]);
  });

  it('reject a document nested too deeply for its steps to be connected, and only when they are', async () => {
    const deep = workflow(`do:\n  - deep: { set: { a: ${'['.repeat(120)}${']'.repeat(120)} } }`);

    expect(await connected(deep)).toEqual([{ pointer: '', detail: anyWords }]);
    expect(await dslProblems(deep, { connecting: false })).toEqual([]);
  });
});

function expectedCircularity(document: { readonly [key: string]: Json }): string {
  try {
    JSON.stringify(document);
    return '';
  } catch (error) {
    return String(error).replace(/^\w*Error: /u, '');
  }
}
