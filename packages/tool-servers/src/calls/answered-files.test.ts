import { textOfContent } from '@on.auto/content';
import { Effect, Option, Struct } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { answerDocument } from '../bounds/tool-results.ts';
import type { FakeTool } from '../mcp-testing/fake-tools.ts';
import { fakeApiKey, openFakeToolRun, type FakeToolRun } from '../testing/fake-tool-run.ts';
import type { CallAnswered, CallEnded } from './call-facts.ts';
import type { CallReply, ToolReply } from './call-replies.ts';
import { keptReply } from './recorded-replies.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const notes = `# Notes\n\n${'Ship on Friday. '.repeat(64)}`;

const anything = { type: 'object', properties: {}, required: [] } as const;

const readsAFile: FakeTool = {
  name: 'read_file',
  inputSchema: anything,
  annotations: { readOnlyHint: true },
  answer: () => ({
    content: [
      { type: 'text', text: 'Read notes.md at 3f2a1c.' },
      { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: notes } },
    ],
  }),
};

const carriesTheKey: FakeTool = {
  name: 'read_files',
  inputSchema: anything,
  annotations: { readOnlyHint: true },
  answer: () => ({
    content: [
      { type: 'text', text: 'Read two files.' },
      {
        type: 'resource',
        resource: { uri: `https://files.example.com/notes.md?key=${fakeApiKey}`, text: `The key is ${fakeApiKey}.` },
      },
      {
        type: 'resource',
        resource: { uri: `file:///${fakeApiKey}.pdf`, mimeType: 'application/pdf', blob: 'JVBERi0K' },
      },
      { type: 'resource_link', uri: `https://files.example.com/rows.csv?key=${fakeApiKey}`, name: 'rows.csv' },
    ],
  }),
};

async function runWith(tool: FakeTool): Promise<FakeToolRun> {
  const run = await openFakeToolRun([tool.name], defaultTiming, { tools: [tool] });
  closing.push(run.close);
  return run;
}

function keptOf({ content }: FakeToolRun, sha256: string | undefined): Promise<string> {
  return Effect.runPromise(
    sha256 === undefined
      ? Effect.succeed('')
      : Effect.flatMap(content.get({ org: 'acme', playbook: 'alpha' }, sha256), (kept) =>
          kept === undefined ? Effect.succeed('') : textOfContent(kept),
        ),
  );
}

function answeredIn(ended: CallEnded): readonly CallAnswered[] {
  return ended.type === 'tool_call_answered' ? [ended.data] : [];
}

const unstopped = new AbortController().signal;

interface Sent {
  readonly answered: readonly CallAnswered[];
  readonly reply: ToolReply;
}

async function sentTo(run: FakeToolRun, callId: string, room?: number): Promise<Sent> {
  const offered = Option.getOrThrow(Option.fromNullishOr(run.tools.offered.at(0)));
  const { ended, reply } = await offered.send(
    { callId, input: {}, ...(room === undefined ? {} : { room }) },
    unstopped,
  );
  return { answered: answeredIn(ended), reply };
}

function rebuilt(run: FakeToolRun, answers: readonly CallAnswered[]) {
  return Promise.all(answers.map(async (answered) => keptReply(answered, await keptOf(run, answered.result_sha256))));
}

function documentOf({ scrubbedResult }: CallReply): Option.Option<unknown> {
  return Option.map(Option.fromNullishOr(scrubbedResult), (answer) => answerDocument(answer));
}

function keptResultOf(run: FakeToolRun): Promise<string> {
  const answered = run.journal.facts().at(-1)?.data;
  return keptOf(run, String(Reflect.get(new Object(answered), 'result_sha256')));
}

describe('the reply rebuilt from what a call that carried a file recorded', () => {
  it('is the reply the model was given, the file whole or cut, in the format its call names', async () => {
    const run = await runWith(readsAFile);
    const sent = [await sentTo(run, 'toolu_1'), await sentTo(run, 'toolu_2', 600)];
    const answers = sent.flatMap(({ answered }) => answered);

    expect(answers.map(({ shown_format: format, shown_bytes: cut }) => [format, cut === undefined])).toEqual([
      [2, true],
      [2, false],
    ]);
    expect(await rebuilt(run, answers)).toEqual(sent.map(({ reply }) => reply));
    expect(sent.map(({ reply }) => reply.text.startsWith('Read notes.md at 3f2a1c.\n# Notes'))).toEqual([true, true]);
  });

  it('is the reply a model was shown in format 1 for a call recorded without a format, a file among its answer', async () => {
    const run = await runWith(readsAFile);
    const { answered } = await sentTo(run, 'toolu_1');

    expect(
      await rebuilt(
        run,
        answered.map((each) => Struct.omit(each, ['shown_format'])),
      ),
    ).toEqual([{ text: 'Read notes.md at 3f2a1c.\n[resource content, not shown]', isError: false }]);
  });
});

describe('a secret inside a file or a link a tool answers', () => {
  it('is scrubbed from what the model reads, from the answer a function reads and from what the run keeps', async () => {
    const run = await runWith(carriesTheKey);

    const reply = await run.call('read_files', {});
    const kept = await keptResultOf(run);

    expect(reply.text).toBe(
      [
        'Read two files.',
        'The key is [redacted].',
        '[resource content (application/pdf), not shown]',
        '{"type":"resource_link","uri":"https://files.example.com/rows.csv?key=[redacted]","name":"rows.csv"}',
      ].join('\n'),
    );
    expect(documentOf(reply)).toEqual(Option.some('Read two files.\nThe key is [redacted].'));
    expect([kept.includes(fakeApiKey), kept.includes('notes.md?key=[redacted]'), kept.includes('JVBERi0K')]).toEqual([
      false,
      true,
      true,
    ]);
  });
});
