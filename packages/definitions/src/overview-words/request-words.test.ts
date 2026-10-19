import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, type OverviewBlock, type OverviewSection } from '../index.ts';
import {
  answerSection,
  answerSentence,
  answerWaitSentence,
  inboxSentence,
  messageLead,
  notTakenSentence,
  notificationSentence,
  partyNamedUnderDetails,
  replyRuleSentence,
  replyWaitSentence,
  unansweredSentence,
  whereSection,
} from './request-words.ts';

function writtenOf(body: readonly OverviewBlock[], appendix: readonly OverviewSection[] = []): string {
  return markdownOf({ title: 'approve-report', opening: ['Asks for an approval'], body, sections: [], appendix })
    .split('\n\n')
    .slice(2)
    .join('\n\n');
}

const approval = {
  type: 'object',
  required: ['approver', 'label', 'draft'],
  properties: {
    approver: { type: 'string', description: 'Chat user id of the approver' },
    label: { type: 'string', description: 'The month, such as April 2026' },
    draft: { type: 'string', description: 'The draft report' },
  },
};

const answer = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'reject'] },
    note: { type: 'string', description: 'What the approver adds' },
    said: { type: 'string' },
  },
};

const sevenDays = 7 * 24 * 3_600_000;

describe('the lead of the message of a request to a person', () => {
  it('says what it is given, whom it sends the message and through which server, before the quote', () => {
    expect([
      writtenOf([messageLead({ input: approval, party: ['the approver'], server: 'gas' })]),
      writtenOf([messageLead({ party: [partyNamedUnderDetails] })]),
    ]).toEqual([
      "It is given the approver, the month and the draft report. It sends the approver this message through **gas**, with the run's values in place of the words in brackets:\n",
      "It is given any input. It sends the party named under Details this message, with the run's values in place of the words in brackets:\n",
    ]);
  });
});

describe('what a request to a person waits for', () => {
  it('is a reply read at least as far apart as it is read, or the answer of whoever may write to the playbook', () => {
    expect([
      replyWaitSentence(sevenDays, 15_000),
      answerWaitSentence(2 * 24 * 3_600_000),
      unansweredSentence(sevenDays),
    ]).toEqual([
      'It waits up to 7 days for a reply to that message, reading the replies at least 15 seconds apart.',
      'It waits up to 2 days for the answer, which whoever may write to the playbook gives.',
      'If nobody answers within 7 days, the request ends unanswered.',
    ]);
  });

  it("is the answer left in the playbook's inbox, or nothing for a notification", () => {
    expect([inboxSentence('answer'), inboxSentence('nothing'), notificationSentence]).toEqual([
      "It leaves the message in the playbook's inbox, where whoever may write to the playbook answers it.",
      "It leaves the message in the playbook's inbox, where whoever may write to the playbook reads it, and waits for nothing.",
      'It sends the message and waits for nothing.',
    ]);
  });
});

describe('how a request takes a reply', () => {
  it('says the words of each value of a first word, what follows it and the whole reply, by the meaning of each field', () => {
    expect(
      replyRuleSentence(
        {
          verdict: {
            from: 'word',
            words: { approve: ['approved', 'yes', 'ok', 'okay', 'lgtm', 'ship'], reject: ['rejected', 'no', 'nope'] },
          },
          note: { from: 'rest' },
          said: { from: 'text' },
        },
        answer,
      ),
    ).toBe(
      'A reply whose first word is approve, approved, yes, ok, okay, lgtm or ship gives the verdict approve; one whose first word is reject, rejected, no or nope gives reject; whatever follows the first word is what the approver adds; the whole reply is the said.',
    );
  });

  it('opens with the part it reads first, and says a reply of another first word is not taken, and the person told', () => {
    expect([
      replyRuleSentence({ note: { from: 'rest' }, verdict: { from: 'word', words: { approve: [] } } }, answer),
      notTakenSentence('another-first-word', true),
      notTakenSentence('another-first-word', false),
      notTakenSentence('unread', true),
    ]).toEqual([
      'Whatever follows the first word is what the approver adds; a reply whose first word is approve gives the verdict approve.',
      'A reply that begins with any other word is not taken, and the person is told how to answer.',
      'A reply that begins with any other word is not taken.',
      'A reply it cannot read is not taken, and the person is told how to answer.',
    ]);
  });
});

describe('what a request to a person answers with', () => {
  it('says each field of the answer by its meaning, one that may be left out when there is one', () => {
    expect(writtenOf([answerSentence(answer)])).toBe(
      'It answers with the verdict, one of approve and reject, what the approver adds, when there is one, and the said, when there is one.\n',
    );
  });
});

describe('the answer of a request, under Details', () => {
  it('is the table of its fields, or says that a notification takes none', () => {
    expect([writtenOf([], [answerSection({ type: 'string' })]), writtenOf([], [answerSection()])]).toEqual([
      '## Details\n\n### Answer\n\nText.\n',
      '## Details\n\n### Answer\n\nNone: it is a notification, which takes no answer and succeeds once its request is delivered.\n',
    ]);
  });
});

describe('where a request goes, under Details', () => {
  it('says its party and its answerer as written, whose reply alone answers where it reads replies, the tools and servers it is sent and read through, and its expiry', () => {
    expect([
      writtenOf(
        [paragraph('Asked.')],
        [
          whereSection({
            to: '{{ input.approver }}',
            route: { server: 'gas', tool: 'execute', replies: { tool: 'execute', wait: 'PT15S' } },
            expires: 'P7D',
          }),
        ],
      ),
      writtenOf(
        [],
        [
          whereSection({
            to: '#approvals',
            from: '{{ input.owner }}',
            route: { server: 'chat', tool: 'post_message', replies: { tool: 'thread_replies' } },
            expires: 'P2D',
          }),
        ],
      ),
      writtenOf(
        [],
        [whereSection({ to: '{{ input.owner }}', route: { server: 'chat', tool: 'post' }, expires: 'P1D' })],
      ),
      writtenOf([], [whereSection({ to: '{{ input.owner }}', expires: 'PT1H' })]),
      writtenOf([], [whereSection({ to: '#approvals', from: '{{ input.owner }}', expires: 'PT1H' })]),
    ]).toEqual([
      'Asked.\n\n## Details\n\n### Where\n\nTo `{{ input.approver }}`, whose reply alone answers it. Sent through the tool `execute` of the server **gas**; the replies read with the tool `execute` of the server **gas**, at least `PT15S` apart; expires after `P7D`.\n',
      '## Details\n\n### Where\n\nTo `#approvals`; answered by `{{ input.owner }}`, whose reply alone counts. Sent through the tool `post_message` of the server **chat**; the replies read with the tool `thread_replies` of the server **chat**; expires after `P2D`.\n',
      '## Details\n\n### Where\n\nTo `{{ input.owner }}`. Sent through the tool `post` of the server **chat**; expires after `P1D`.\n',
      "## Details\n\n### Where\n\nTo `{{ input.owner }}`. Left in the playbook's inbox; expires after `PT1H`.\n",
      "## Details\n\n### Where\n\nTo `#approvals`; its answerer `{{ input.owner }}`. Left in the playbook's inbox; expires after `PT1H`.\n",
    ]);
  });
});
