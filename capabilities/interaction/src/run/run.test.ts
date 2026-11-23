import { describe, expect, it } from 'vitest';

import { listInteractions } from '../requests/list-interactions.ts';
import {
  approvalDocument,
  chatDelivery,
  fakeTools,
  type HarnessTools,
  interactionHarness,
  noTools,
  threadDocument,
} from '../testing/index.ts';
import { answering, delivering, documentOf, reading, replacing } from '../testing/route-documents.ts';

const anyWords: unknown = expect.any(String);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function askedInAThread(owner: string) {
  const playbook = interactionHarness({ tools: fakeTools() });
  await playbook.define('approve-brief', threadDocument());
  await playbook.ask('approve-brief', { team: 'sales', owner, campaign: 'Spring' }, runId);
  return playbook.runOf(runId);
}

describe('the answerer of a request', () => {
  it('is the party the function names in from, recorded with the reply rule beside the answer schema', async () => {
    expect(await askedInAThread('U024BE7LH')).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'started',
        record: {
          to: '#approvals-sales',
          answerer: 'U024BE7LH',
          reply: {
            choice: { from: 'word', words: { approve: ['approved', 'yes', 'ok'], reject: ['rejected', 'no'] } },
            note: { from: 'rest' },
          },
        },
      },
    });
  });

  it('is the party the request goes to when the function gives no from', async () => {
    const playbook = interactionHarness();
    await playbook.define('approve-brief', approvalDocument());

    await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);

    expect(await playbook.runOf(runId)).toMatchObject({
      output: { record: { to: 'ada', answerer: 'ada', reply: { choice: { from: 'word' } } } },
    });
  });
});

describe('an answerer a run cannot record', () => {
  it('ends the run as unworkable when from renders to nothing or holds a control character', async () => {
    expect([await askedInAThread(' '), await askedInAThread('U02\u0007')]).toMatchObject([
      {
        status: 'succeeded',
        output: {
          status: 'rejected',
          rejection: {
            reason: 'conflict',
            kind: 'unworkable',
            detail: 'The party whose reply counts renders to nothing',
          },
        },
      },
      {
        output: {
          rejection: {
            reason: 'conflict',
            detail: anyWords,
          },
        },
      },
    ]);
  });
});

const brief = { campaign: 'Spring', owner: 'ada' };

async function askedThrough(source: string, tools: HarnessTools, input: unknown = brief) {
  const playbook = interactionHarness({ tools });
  await playbook.define('approve-brief', source);
  const asked = await playbook.ask('approve-brief', input, runId);
  return { playbook, asked };
}

const notOffered = { status: 'rejected', reason: 'unavailable', kind: 'tool_not_offered' };

describe('a run whose delivery names a tool this playbook may not use', () => {
  it('is unavailable before it asks anything, for a server not configured for the playbook', async () => {
    const { playbook, asked } = await askedThrough(documentOf(delivering, answering), noTools);

    expect(asked).toMatchObject({
      ...notOffered,
      because: 'tool_server_not_configured',
      detail: 'No tool server named chat is configured for this playbook',
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
  });

  it('is unavailable for a server the tool servers of the playbook do not hold', async () => {
    const elsewhere = replacing(delivering, '  server: chat', '  server: elsewhere');

    expect((await askedThrough(documentOf(elsewhere, answering), fakeTools())).asked).toMatchObject({
      ...notOffered,
      because: 'tool_server_not_configured',
      detail: anyWords,
    });
  });

  it.each(['post_message', 'thread_replies'])('is unavailable when the operator does not allow %s', async (tool) => {
    const tools = fakeTools();
    tools.disallow(tool);

    const { asked } = await askedThrough(documentOf(delivering, reading, answering), tools);

    expect(asked).toMatchObject({
      ...notOffered,
      because: 'tool_not_allowed',
      detail: `Whoever runs this server does not allow chat/${tool}`,
    });
    expect(tools.calls()).toEqual([]);
  });
});

function text(template: string): readonly string[] {
  return replacing(delivering, "    text: '{{ message }}'", `    text: '${template}'`);
}

function inputOf(more: number) {
  return { ...brief, text: 'x'.repeat(524_000), more: 'y'.repeat(more) };
}

const anyText: unknown = anyWords;

describe('the arguments of a delivery, at the start of its run', () => {
  it('take as many bytes as JSON as their server may be sent, and end the run as unworkable one byte past it', async () => {
    const twiceAndMore = text('{{ input.text }}{{ input.text }}{{ input.more }}');
    const source = documentOf(replacing(twiceAndMore, "    channel: '{{ to }}'", ''), answering);

    expect([
      (await askedThrough(source, fakeTools(), inputOf(565))).asked,
      (await askedThrough(source, fakeTools(), inputOf(566))).asked,
    ]).toMatchObject([
      { status: 'succeeded', output: { status: 'started' } },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail:
          'The arguments of the call that delivers the request take 1048577 bytes, more than the 1 MiB a call may send to a tool server; give the function a smaller input',
      },
    ]);
  });

  it('end the run as unworkable for an argument that renders no text or reads what the request lacks', async () => {
    expect([
      (
        await askedThrough(documentOf(text('Detail: {{ input.detail }}'), answering), fakeTools(), {
          ...brief,
          detail: { name: 'ada' },
        })
      ).asked,
      (await askedThrough(documentOf(text('{{ input.extra.name }}'), answering), fakeTools())).asked,
    ]).toMatchObject([
      {
        reason: 'conflict',
        kind: 'unworkable',
        detail: anyWords,
      },
      {
        reason: 'conflict',
        detail: anyWords,
      },
    ]);
  });
});

describe('the delivery of a request, as its record keeps it', () => {
  it('is recorded as written in the request, beside its moment, with how it reads replies', async () => {
    const { playbook } = await askedThrough(documentOf(delivering, reading, answering), fakeTools());

    expect(await playbook.runOf(runId)).toMatchObject({
      output: {
        record: {
          deliver: { server: 'chat', tool: 'post_message', with: { text: '{{ message }}' } },
          replies: { tool: 'thread_replies' },
          requested_at: anyText,
        },
      },
    });
    expect(chatDelivery).toContain('deliver:');
  });
});
