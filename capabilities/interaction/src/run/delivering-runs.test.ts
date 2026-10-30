import { describe, expect, it } from 'vitest';

import { listInteractions } from '../requests/list-interactions.ts';
import { chatDelivery, fakeTools, interactionHarness, noTools, type HarnessTools } from '../testing/index.ts';
import { answering, delivering, documentOf, reading, replacing } from '../testing/route-documents.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

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
      detail: 'No tool server named elsewhere is configured for this playbook',
    });
  });

  it.each(['post_message', 'thread_replies'])('is unavailable when the operator does not allow %s', async (tool) => {
    const tools = fakeTools();
    tools.disallow(tool);

    const { asked } = await askedThrough(documentOf(delivering, reading, answering), tools);

    expect(asked).toMatchObject({
      ...notOffered,
      because: 'tool_not_allowed',
      detail: `The operator of this server does not allow chat/${tool}`,
    });
    expect(tools.calls()).toEqual([]);
  });
});

function text(template: string): readonly string[] {
  return replacing(delivering, "    text: '{{ message }}'", `    text: '${template}'`);
}

function inputOf(length: number) {
  return { ...brief, text: 'x'.repeat(length) };
}

const anyText: unknown = expect.any(String);

describe('the arguments of a delivery, at the start of its run', () => {
  it('take 16 KiB as JSON, and end the run as unworkable one byte past it', async () => {
    const source = documentOf(replacing(text('{{ input.text }}'), "    channel: '{{ to }}'", ''), answering);

    expect([
      (await askedThrough(source, fakeTools(), inputOf(16_373))).asked,
      (await askedThrough(source, fakeTools(), inputOf(16_374))).asked,
    ]).toMatchObject([
      { status: 'succeeded', output: { status: 'started' } },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail:
          'The arguments of the call that delivers the request take 16385 bytes, more than the 16384 a call may send',
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
        detail:
          'The argument text of the call that delivers the request renders a value that is not text for this request',
      },
      {
        reason: 'conflict',
        detail: 'The argument text of the call that delivers the request reads what this request does not have',
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
