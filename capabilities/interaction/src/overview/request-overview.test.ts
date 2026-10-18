import { sectionIn } from '@on.auto/definitions/testing';
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
  return Effect.runSync(capability.prepare(source)).overview('approve-brief');
}

function waitOf(expires: string): string {
  return sectionIn(overviewOf(approvalDocument([], expires)), 'How long it waits');
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

describe('how long a request waits, in the overview', () => {
  it('says the expiry in days, hours, minutes and seconds, to the nearest second', () => {
    expect(['P2D', 'PT1M', 'PT4H', 'P1DT12H30M', 'PT90.5S', 'P1W'].map((expires) => waitOf(expires))).toEqual(
      ['2 days', '1 minute', '4 hours', '1 day, 12 hours, and 30 minutes', '1 minute and 31 seconds', '7 days'].map(
        (words) => `It waits up to ${words} for the answer; a request nobody answers by then ends unanswered.`,
      ),
    );
  });

  it('says of a notification when its request expires, and that it takes no answer', () => {
    const overview = overviewOf(notificationDocument());

    expect(sectionIn(overview, 'How long it waits')).toBe('Its request expires after 1 hour.');
    expect(sectionIn(overview, 'Where')).toBe(
      "It leaves the request in the playbook's inbox, where a caller who may write to the playbook reads it.",
    );
    expect(sectionIn(overview, 'What answer it expects')).toBe(
      'None: it is a notification, which takes no answer and succeeds once its request is delivered.\n',
    );
    expect(overview).not.toContain('## Replies');
  });
});

describe('what a request needs, in the overview', () => {
  it('is the first section, the fields each run gives it, before who it asks', () => {
    const overview = overviewOf(approvalDocument());

    expect(overview.split('\n\n## ').slice(1, 3)).toEqual([
      'What it needs\n\n| Field | Required | What it is |\n| --- | --- | --- |\n| **campaign** | yes | Text. |\n| **owner** | yes | Text. |',
      'Who it asks\n\nIt asks a person, and each request goes to **owner**.',
    ]);
  });
});

describe('who a request asks, in the overview', () => {
  it('reads the party and the answerer through the reader of templates', () => {
    expect(sectionIn(overviewOf(threadDocument()), 'Who it asks')).toBe(
      [
        'It asks a person, and each request goes to #approvals-**team**.',
        'Its answerer, whose reply counts, is **owner**.',
      ].join('\n\n'),
    );
  });

  it('reads a party written with a condition on one line into the sentence that leads to it', () => {
    const source = approvalDocument().replace(
      "to: '{{ input.owner }}'",
      "to: '{% if input.urgent %}on-call{% else %}{{ input.owner }}{% endif %}'",
    );

    expect(sectionIn(overviewOf(source), 'Who it asks')).toBe(
      'It asks a person, and each request goes to on-call when input.urgent, otherwise **owner**.',
    );
  });

  it('shows a party written with a condition over lines under the sentence that leads to it', () => {
    const source = approvalDocument().replace(
      "to: '{{ input.owner }}'",
      'to: "{% if input.urgent %}on-call\\n{% else %}{{ input.owner }}{% endif %}"',
    );

    expect(sectionIn(overviewOf(source), 'Who it asks')).toBe(
      [
        'It asks a person, and each request goes to the party this names:',
        '*When input.urgent:*',
        'on-call',
        '*Otherwise:*',
        '**owner**',
      ].join('\n\n'),
    );
  });
});

describe('the replies of a request, in the overview', () => {
  it('say the reply rule of each part, the words that mean each value and who answers', () => {
    const source = threadDocument({ rule: [] }).replace(/output:\n[\s\S]*maxLength: 2000 \}/u, choices.join('\n'));

    expect(sectionIn(overviewOf(source), 'Replies')).toBe(
      [
        'It reads the replies to its message with the tool **thread_replies** of **chat**, and a reply from its answerer answers it when its reply rule reads it:',
        [
          '- **decision**, from the first word of the reply: `approve` (or `yes`), `revise` or `skip` (or `later`, `pass`)',
          '- **note**, from the words that follow the first',
          '- **said**, from the whole reply',
        ].join('\n'),
        'A reply the rule cannot read is refused, and the party is told how to answer.\n',
      ].join('\n\n'),
    );
  });

  it('say that a reply the rule cannot read is refused, without telling the party where the function does not', () => {
    const source = threadDocument({ replies: threadReplies.slice(0, -5) });

    expect(sectionIn(overviewOf(source), 'Replies')).toMatch(/\n\nA reply the rule cannot read is refused\.\n$/u);
  });

  it('are left out of a function that reads no replies', () => {
    expect(overviewOf(approvalDocument(chatDelivery))).not.toContain('## Replies');
  });
});
