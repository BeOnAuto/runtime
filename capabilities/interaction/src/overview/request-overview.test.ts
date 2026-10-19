import { markdownOf } from '@on.auto/definitions';
import { onTheStandingClock } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  approvalDocument,
  chatDelivery,
  interactionHarness,
  notificationDocument,
  threadDocument,
  threadReplies,
} from '../testing/index.ts';

const { capability } = interactionHarness();

function overviewOf(source: string): string {
  return markdownOf(Effect.runSync(onTheStandingClock(capability.prepare(source))).overview('approve-brief'));
}

function bodyOf(source: string): readonly string[] {
  const [story = ''] = overviewOf(source).split('\n\n## Details\n\n');
  return story.split('\n\n').slice(2);
}

function leadOf(source: string): string {
  return bodyOf(source).find((block) => block.startsWith('It is given')) ?? '';
}

function leadTo(to: string): string {
  return leadOf(approvalDocument().replace("to: '{{ input.owner }}'", to));
}

function detailsIn(overview: string, heading: string): string {
  return overview.split(`\n\n### ${heading}\n\n`)[1]?.split('\n\n### ')[0] ?? '';
}

function waitOf(expires: string): string {
  return bodyOf(approvalDocument([], expires)).at(-2) ?? '';
}

const choices = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [decision]',
  '    properties:',
  '      decision: { type: string, enum: [approve, revise, skip] }',
  '      note: { type: string }',
  '      said: { type: string }',
  'reply:',
  '  decision: { from: word, words: { approve: [yes], skip: [later, pass] } }',
  '  note: rest',
  '  said: text',
];

const counted = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [count]',
  '    properties:',
  '      count: { type: integer }',
];

describe('how long a request waits, in the overview', () => {
  it('says the expiry in days, hours, minutes and seconds, to the nearest second, for a request left in the inbox', () => {
    expect(['P2D', 'PT1M', 'PT4H', 'P1DT12H30M', 'PT90.5S', 'P1W'].map((expires) => waitOf(expires))).toEqual(
      ['2 days', '1 minute', '4 hours', '1 day, 12 hours, and 30 minutes', '1 minute and 31 seconds', '7 days'].map(
        (words) =>
          `It leaves the message in the playbook's inbox, where whoever may write to the playbook answers it. If nobody answers within ${words}, the request ends unanswered.`,
      ),
    );
  });

  it('says of a notification that it waits for nothing, takes no answer and draws nothing, with its expiry under Details', () => {
    const inbox = overviewOf(notificationDocument());
    const sent = overviewOf(notificationDocument(chatDelivery));

    expect([bodyOf(notificationDocument()).at(-1), bodyOf(notificationDocument(chatDelivery)).at(-1)]).toEqual([
      "It leaves the message in the playbook's inbox, where whoever may write to the playbook reads it, and waits for nothing.",
      'It sends the message and waits for nothing.',
    ]);
    expect([detailsIn(inbox, 'Answer'), detailsIn(sent, 'Where')]).toEqual([
      'None: it is a notification, which takes no answer and succeeds once its request is delivered.',
      'To `{{ input.owner }}`. Sent through the tool `post_message` of the server **chat**; expires after `PT1H`.\n',
    ]);
    expect([inbox, sent].map((overview) => [overview.includes('mermaid'), overview.includes('It answers')])).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it('says that a request sent through a tool whose replies it does not read waits for the answer of whoever may write', () => {
    expect([
      bodyOf(approvalDocument(chatDelivery)).at(-2),
      bodyOf(approvalDocument(chatDelivery, 'P2D', counted)),
    ]).toEqual([
      'It waits up to 2 days for the answer, which whoever may write to the playbook gives. If nobody answers within 2 days, the request ends unanswered.',
      [
        "It is given the campaign and the owner. It sends the owner this message through **chat**, with the run's values in place of the words in brackets:",
        '> Please review the brief for \\[the campaign\\].',
        'It waits up to 2 days for the answer, which whoever may write to the playbook gives. If nobody answers within 2 days, the request ends unanswered.',
        'It answers with the count.',
      ],
    ]);
  });
});

describe('what a request is given and whom it asks, in the overview', () => {
  it('says the fields it is given, then the party the value of its to means, before the message it quotes', () => {
    expect(bodyOf(approvalDocument()).slice(0, 2)).toEqual([
      "It is given the campaign and the owner. It sends the owner this message, with the run's values in place of the words in brackets:",
      '> Please review the brief for \\[the campaign\\].',
    ]);
  });

  it('names a party written as text on one line as it is written, and any other party by the party named under Details', () => {
    expect([
      leadTo("to: '#approvals'"),
      leadTo("to: '{% if input.urgent %}on-call{% else %}{{ input.owner }}{% endif %}'"),
      leadTo('to: "{{ input.owner }}\\n{{ input.campaign }}"'),
      leadTo("to: '{{ input.owner }} {{ input.campaign }}'"),
    ]).toEqual([
      "It is given the campaign and the owner. It sends #approvals this message, with the run's values in place of the words in brackets:",
      "It is given the campaign and the owner. It sends the party named under Details this message, with the run's values in place of the words in brackets:",
      "It is given the campaign and the owner. It sends the party named under Details this message, with the run's values in place of the words in brackets:",
      "It is given the campaign and the owner. It sends the party named under Details this message, with the run's values in place of the words in brackets:",
    ]);
  });

  it('writes the party and the answerer as their document writes them under Details', () => {
    expect(detailsIn(overviewOf(threadDocument()), 'Where')).toBe(
      'To `#approvals-{{ input.team }}`, answered by `{{ input.owner }}`. Sent through the tool `post_message` of the server **chat**; the replies read with the tool `thread_replies` of the server **chat**, at least `PT1M` apart; expires after `P2D`.\n',
    );
  });
});

describe('the replies of a request, in the overview', () => {
  it('say how a reply gives each part of the answer, what it reads first and that a reply of another word is not taken', () => {
    const source = threadDocument({ rule: [] }).replace(/output:\n[\s\S]*maxLength: 2000 \}/u, choices.join('\n'));

    expect(bodyOf(source).slice(-2)).toEqual([
      'It waits up to 2 days for a reply to that message, reading the replies at least 1 minute apart. A reply whose first word is approve or yes gives the decision approve; one whose first word is revise gives revise; one whose first word is skip, later or pass gives skip; whatever follows the first word is the note; the whole reply is the said. A reply that begins with any other word is not taken, and the person is told how to answer. If nobody answers within 2 days, the request ends unanswered.',
      'It answers with the decision, one of approve, revise and skip, the note, when there is one, and the said, when there is one.',
    ]);
  });

  it('say that a reply of another word is not taken, without telling the person where the function does not', () => {
    const source = threadDocument({ replies: threadReplies.slice(0, -5) });

    expect(bodyOf(source).at(-2)).toMatch(/ A reply that begins with any other word is not taken\. If nobody/u);
    expect(overviewOf(source)).toContain('  n4 -.->|"any other word"| n3\n');
  });

  it('draw no reply and refuse no word of a rule that reads no first word', () => {
    const overview = overviewOf(threadDocument({ rule: ['reply:', '  note: text'] }));

    expect(overview).not.toContain('mermaid');
    expect(overview).not.toContain('not taken');
    expect(overview).toContain('reading the replies at least 1 minute apart. The whole reply is the note. If nobody');
  });
});
