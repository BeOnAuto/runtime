import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testWorkflowPolicy } from '../testing/test-sandbox.ts';
import { parseWorkflowDocument } from './workflow-document.ts';
import { summaryOf } from './workflow-summary.ts';

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: greeting
  version: '1.0.0'
`;

function parsed(source: string) {
  return Effect.runPromise(Effect.result(parseWorkflowDocument(source, testWorkflowPolicy)));
}

function scheduled(timeZone: string): string {
  return `${header}schedule:\n  cron: '0 6 * * *'\n  time_zone: ${timeZone}\ndo:\n  - greet: { set: { a: 1 } }\n`;
}

function rejected(detail: string, issues: readonly string[]) {
  return {
    _tag: 'Failure',
    failure: new InvalidInput({ detail, issues: issues.map((issue) => ({ detail: issue, pointer: '' })) }),
  };
}

describe('parsing a workflow document', () => {
  it('gives the document as JSON when it is valid and allowed', async () => {
    expect(await parsed(`${header}do:\n  - greet: { set: { a: 1 } }\n`)).toMatchObject({
      _tag: 'Success',
      success: { do: [{ greet: { set: { a: 1 } } }] },
    });
  });

  it('rejects YAML it does not read, with the line of each problem', async () => {
    expect(await parsed('a: 1\na: 2\n')).toMatchObject(
      rejected('The workflow document is not YAML this runtime reads', ['Line 2, column 1: Map keys must be unique']),
    );
  });
});

describe('a document that breaks the DSL', () => {
  it('is rejected with each problem at its line', async () => {
    expect(await parsed(`${header}do:\n  - loop:\n      for: { each: item }\n      do: []\n`)).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        'Line 8, column 12: at /do/0/loop/for: It needs in',
      ]),
    );
  });

  it('is read without the time zone of its cron schedule, which the runtime checks at its line', async () => {
    expect([await parsed(scheduled('America/New_York')), await parsed(scheduled('Mars/Olympus'))]).toMatchObject([
      { _tag: 'Success', success: { schedule: { cron: '0 6 * * *', time_zone: 'America/New_York' } } },
      rejected('The workflow document is not a workflow this runtime runs', [
        'Line 8, column 14: at /schedule/time_zone: time_zone expects an IANA time zone name such as Europe/London, not "Mars/Olympus"',
      ]),
    ]);
  });

  it('is rejected for steps that do not connect', async () => {
    const source = `${header}do:\n  - s: { switch: [{ always: { then: nowhere } }] }\n`;

    expect(await parsed(source)).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        "Line 1, column 1: The steps of the workflow do not connect: Unable to find task to transition to 'nowhere' from 's'",
      ]),
    );
  });
});

describe('a document the runtime does not run', () => {
  it('is rejected for what the policy rejects, reported once where the DSL agrees', async () => {
    const source = `${header}do:\n  - a: { set: { x: 1 }, then: nowhere }\n  - b: { wait: soon, then: nowhere }\n`;

    expect(await parsed(source)).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        'Line 7, column 31: at /do/0/a/then: then: nowhere names no task in the same list',
        'Line 8, column 16: at /do/1/b/wait: soon is not an ISO 8601 duration',
        'Line 8, column 28: at /do/1/b/then: then: nowhere names no task in the same list',
      ]),
    );
  });

  it('is rejected for a DSL version other than 1.0.x, without asking the DSL', async () => {
    expect(await parsed(header.replace("'1.0.3'", "'0.9.0'") + 'do: []\n')).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        'Line 2, column 8: at /document/dsl: This runtime runs documents of DSL 1.0.x, not 0.9.0',
      ]),
    );
  });
});

describe('a workflow document that waits longer than a workflow may run', () => {
  it('is rejected at the duration, against 30 days unless told otherwise', async () => {
    const source = `${header}do:\n  - pause: { wait: P31D }\n`;

    expect(await parsed(source)).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        'Line 7, column 20: at /do/0/pause/wait: This duration, 2678400000 ms, is longer than the 2592000000 ms a workflow may run',
      ]),
    );
    expect(
      await Effect.runPromise(Effect.result(parseWorkflowDocument(source, testWorkflowPolicy, 31 * 86_400_000))),
    ).toMatchObject({
      _tag: 'Success',
    });
  });
});

function nestedTasks(levels: number): string {
  return `${header}do: ${'[{ inner: { do: '.repeat(levels - 1)}[]${' } }]'.repeat(levels - 1)}\n`;
}

describe('a workflow document that nests too deeply', () => {
  it('is rejected before it is read when it nests values more than 512 levels deep', async () => {
    expect(await parsed(nestedTasks(1000))).toMatchObject(
      rejected('The workflow document is not YAML this runtime reads', [
        'Line 6, column 2726: The document nests values more than 512 levels deep',
      ]),
    );
  });

  it('is rejected at the list too deep when it nests tasks more than 64 levels deep, without asking the DSL', async () => {
    const pointer = `/do${'/0/inner/do'.repeat(64)}`;

    expect(await parsed(nestedTasks(100))).toMatchObject(
      rejected('The workflow document is not a workflow this runtime runs', [
        `Line 6, column 1029: at ${pointer}: The document nests tasks more than 64 levels deep`,
      ]),
    );
  });
});

describe('the summary of a workflow definition', () => {
  it('is the summary or title of the document and its inline input and output schemas', () => {
    expect(
      summaryOf({
        document: { summary: 'Greets', title: 'Greeting' },
        input: { schema: { document: { type: 'object' } } },
        output: { schema: { document: { type: 'string' } } },
        do: [],
      }),
    ).toEqual({
      description: 'Greets',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'string' },
    });
    expect(summaryOf({ document: { title: 'Greeting' }, do: [] })).toEqual({ description: 'Greeting' });
    expect(summaryOf({ do: [] })).toEqual({});
  });

  it('gives the triggers its schedule names, in the order it names them', () => {
    expect(summaryOf({ schedule: { every: 'PT1H', cron: '0 9 * * *' }, do: [] })).toEqual({
      triggers: [
        { kind: 'every', reference: '/schedule/every', milliseconds: 3_600_000 },
        { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * *' },
      ],
    });
  });
});
