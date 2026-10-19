import { readFileSync } from 'node:fs';

import { markdownOf, type Overview } from '@on.auto/definitions';
import { onTheStandingClock, overviewAsRead } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callDocument, interactionHarness } from '../testing/index.ts';

const { capability } = interactionHarness();

function examplesOf(page: string): readonly string[] {
  const text = readFileSync(new URL(`../../../../docs/reference/${page}`, import.meta.url), 'utf8');
  return [...text.matchAll(/```markdown\n([\s\S]*?)```/gu)].map(([, body = '']: readonly string[]) => body);
}

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function composedOf(source: string, name: string): Overview {
  return Effect.runSync(onTheStandingClock(capability.prepare(source))).overview(name);
}

function overviewOf(source: string, name = 'read-thread'): string {
  return markdownOf(composedOf(source, name));
}

const [inboxExample = '', chatExample = ''] = examplesOf('interaction-format.md');

const callExample = examplesOf('computation-format.md').find((example) => example.includes('\ncall:\n')) ?? '';

const approveReport = [
  '---',
  'description: Sends the draft report to the approver in the team chat and waits for a reply of approve or reject in the thread',
  "to: '{{ input.approver }}'",
  'expires: P7D',
  'deliver:',
  '  server: gas',
  '  tool: execute',
  '  with:',
  '    function: postForApproval',
  "    parameters: ['{{ to }}', '{{ message }}']",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
  'replies:',
  '  tool: execute',
  '  with:',
  '    function: repliesSince',
  `    parameters: ['{{ sent.conversation }}', '{{ sent.id }}', '{{ since | default: "0" }}']`,
  '  read:',
  '    list: /replies',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text }',
  '  wait: PT15S',
  '  tell:',
  '    with:',
  '      function: replyInThread',
  "      parameters: ['{{ sent.conversation }}', '{{ sent.id }}', '{{ message }}']",
  'reply:',
  '  verdict: { from: word, words: { approve: [approved, yes, ok, okay, lgtm, ship], reject: [rejected, no, nope] } }',
  '  note: rest',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [approver, label, draft]',
  '    properties:',
  "      approver: { type: string, description: 'Chat user id of the approver' }",
  "      label: { type: string, description: 'The month, such as April 2026' }",
  "      draft: { type: string, maxLength: 6000, description: 'The draft report' }",
  'output:',
  '  schema:',
  '    type: object',
  '    required: [verdict]',
  '    properties:',
  '      verdict: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
  '---',
  ':wave: Draft website report for *{{ input.label }}* is ready for your okay before it goes to #random.',
  '',
  '{{ input.draft }}',
  '',
  'Reply *in this thread* with *approve* to log it in the tracker sheet and post it, or *reject* (optionally with a note).',
].join('\n');

describe('the overviews of the examples of the reference of interaction functions', () => {
  it('are, byte for byte, the overviews pinned beside this test, of a request to the inbox and through a chat', () => {
    expect(overviewOf(inboxExample, 'approve-brief')).toBe(goldenOf('reference-inbox.overview.md'));
    expect(overviewOf(chatExample, 'approve-draft')).toBe(goldenOf('reference-chat.overview.md'));
  });

  it('is, byte for byte for the function that asks a system, the overview pinned beside this test', () => {
    expect(overviewOf(callExample, 'read-campaign-costs')).toBe(goldenOf('reference-call.overview.md'));
  });
});

describe('the overview of an interaction function that asks a person and reads the replies to its message', () => {
  it('draws the reply, quotes the message with its values in brackets and tells what happens, as read the overview pinned beside this test', () => {
    const caller = {
      type: 'workflow',
      name: 'monthly-website-report',
      details: {
        title: 'Monthly website report',
        calls: [{ type: 'interaction', name: 'approve-report', steps: [{ number: 6, name: 'send-draft' }] }],
      },
    };
    const overview = composedOf(approveReport, 'approve-report');

    expect(overviewAsRead({ type: 'interaction', name: 'approve-report', overview }, [caller])).toBe(
      goldenOf('approve-report.overview.md'),
    );
  });
});

describe('the overview of an interaction function that asks a system', () => {
  it('names the server and the tool it asks, the input it is given and where in the answer it reads, in one paragraph', () => {
    const source = callDocument({ read: '/data/items~1all~0x' });

    expect(composedOf(source, 'read-thread').body).toHaveLength(1);
    expect(overviewOf(source).split('\n\n')[2]).toBe(
      'It is given the channel and the thread and asks **chat** with its tool thread, once per run. It answers with what it answered under data, then items/all~x: a list of records.',
    );
  });

  it('answers with the whole answer without read, and writes the arguments of a call that reads no input as written', () => {
    const overview = overviewOf(callDocument({ read: null, input: [], with: ['    limit: 100'] }));

    expect(overview).toContain(
      'It is given any input and asks **chat** with its tool thread, once per run. It answers with the whole of what the tool answered:',
    );
    expect(overview).toContain(
      '### Call\n\nIt calls the tool `thread` of the server **chat**, its whole answer read, with these arguments, as written:\n\n- `limit`: `100`\n',
    );
  });
});

describe('the overview of an interaction function whose document has an about', () => {
  it('writes the about as its author wrote it, after the description and before what it is given', () => {
    const about = [
      'about: |',
      '  The campaign team reads what a thread said before it plans the next brief.',
      '',
      '  A workflow asks it once a thread is closed.',
    ];

    expect(
      overviewOf(callDocument({ front: about }))
        .split('\n\n')
        .slice(0, 4),
    ).toEqual([
      '# read-thread',
      'Read the replies of a thread in the team chat, oldest first.',
      'The campaign team reads what a thread said before it plans the next brief.',
      'A workflow asks it once a thread is closed.',
    ]);
  });
});
