import type { Schema } from 'effect';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { callRuns } from '../testing/call-runs.ts';
import { callDocument } from '../testing/index.ts';

const anyOutput = ['output:', '  schema: {}'];

const open = ['input:', '  schema: { type: object }'];

function unworkable(detail: unknown) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'unworkable', detail }));
}

function nestedIn(levels: number): Schema.Json {
  return Array.from({ length: levels }).reduce<Schema.Json>((inner) => ({ n: inner }), 'leaf');
}

describe('a run that asks a system and cannot read what the tool answered', () => {
  it('is unworkable when the answer has no document, or nothing at read, in a structure or in a text', async () => {
    const { run } = await callRuns();

    expect([
      await run(callDocument({ tool: 'photo', read: null, with: [], output: anyOutput })),
      await run(callDocument({ read: '/nothing' })),
      await run(callDocument({ tool: 'search', read: '/rows', with: ['    query: acme'], output: anyOutput })),
    ]).toEqual([
      unworkable('The photo tool of chat answered neither structured content nor text, so there is nothing to read'),
      unworkable('The answer of the thread tool of chat holds nothing at /nothing'),
      unworkable('The search tool of chat answered text that is not JSON, which holds nothing at /rows'),
    ]);
  });

  it('is unworkable when what it reads takes more than a run may record, nests deeper than 512 levels, or does not match the output schema', async () => {
    const { run } = await callRuns();
    const deep = callDocument({
      tool: 'echo',
      read: null,
      with: ["    deep: { inner: '{{ input.deep }}' }"],
      input: open,
      output: anyOutput,
    });

    expect([
      await run(callDocument({ tool: 'large', read: null, with: ['    kib: 1024'], output: anyOutput })),
      await run(deep, { deep: nestedIn(511) }),
      await run(callDocument({ output: ['output:', '  schema: { type: string }'] })),
    ]).toEqual([
      unworkable(
        expect.stringMatching(
          /^What the large tool of chat answered takes \d+ bytes as JSON with the record of the run, more than the 1048576 a run may record$/u,
        ),
      ),
      unworkable(
        'What the echo tool of chat answered nests deeper than the 512 levels a value may. The tool ran and may have changed something; a run again calls it again',
      ),
      unworkable(
        expect.stringMatching(
          /^What the thread tool of chat answered at \/messages does not match the output schema: the answer: /u,
        ),
      ),
    ]);
  });
});

const countOutput = [
  'output:',
  '  schema: { type: object, required: [count], properties: { count: { type: number } } }',
];

describe('a run that asks a system whose tool answers a large part', () => {
  it('answers with the whole part, past what an answer of a person may take and within what a run may record', async () => {
    const { run } = await callRuns();

    const ran = await run(callDocument({ tool: 'large', read: null, with: ['    kib: 370'], output: anyOutput }));

    expect(ran).toEqual(Exit.succeed({ output: '😀'.repeat(370 * 256), record: { server: 'chat', tool: 'large' } }));
  });
});

describe('a run that asks a system whose answer the playbook cannot use', () => {
  it('checks what a tool answered against its own output schema, whatever schema the tool declares', async () => {
    const { fake, run } = await callRuns();

    expect(await run(callDocument({ tool: 'promised', read: null, with: [], output: countOutput }))).toEqual(
      unworkable('What the promised tool of chat answered does not match the output schema: /count: Expected number'),
    );
    expect(fake.received()).toHaveLength(1);
  });

  it('says that running it again calls the tool again when the tool may change something', async () => {
    const { run } = await callRuns({ server: { hints: { thread: { readOnlyHint: false } } } });

    expect(await run(callDocument({ read: '/nothing' }))).toEqual(
      unworkable(
        'The answer of the thread tool of chat holds nothing at /nothing. The tool ran and may have changed something; a run again calls it again',
      ),
    );
  });
});
