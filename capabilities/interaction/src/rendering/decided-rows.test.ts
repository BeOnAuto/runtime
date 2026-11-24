import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { slackMessageOf } from './slack-target.ts';

const buttons = {
  approve: {
    type: 'Button',
    props: { label: 'Approve', once: true, sets: [{ at: { $template: '/decisions/${id}' }, value: 'approve' }] },
  },
  reject: {
    type: 'Button',
    props: { label: 'Reject', once: true, sets: [{ at: { $template: '/decisions/${id}' }, value: 'reject' }] },
  },
  all: {
    type: 'Button',
    props: {
      label: 'Both',
      once: true,
      sets: [
        { at: '/decisions/a', value: 'approve' },
        { at: '/decisions/b', value: 'approve' },
      ],
    },
  },
  link: { type: 'LinkButton', props: { label: 'Open', url: 'https://example.com' } },
};

const card = {
  root: 'card',
  elements: {
    card: { type: 'Card', props: { title: 'Review' }, children: ['rows', 'everything', 'links'] },
    rows: { type: 'Section', repeat: { statePath: '/input/items' }, children: ['name', 'row'] },
    name: { type: 'Text', props: { content: { $item: 'id' } } },
    row: { type: 'Actions', children: ['approve', 'reject'] },
    everything: { type: 'Actions', children: ['all'] },
    links: { type: 'Actions', children: ['link'] },
    ...buttons,
  },
};

const input = { items: [{ id: 'a' }, { id: 'b' }] };

const moment = { today: '2026-10-07', now: '2026-10-07T09:00:00.000Z' };

function drawn(state: {
  readonly answer?: Schema.Json;
  readonly answered?: Schema.Json;
  readonly finished?: 'answered' | 'closed';
}) {
  const { payload, text } = Result.getOrThrow(slackMessageOf(card, { input, ...moment, ...state }));
  const shown = JSON.stringify(payload);
  return { text, buttons: shown.match(/auto-answer:\w+/gu)?.length ?? 0 };
}

const by = (who: string) => ({ by: who, at: 'then' });

describe('a row whose buttons are all taken away', () => {
  it('names what was chosen and who chose it, and keeps the live buttons of the rows not decided', () => {
    const state = {
      answer: { decisions: { a: 'reject' } },
      answered: { decisions: { a: by('U1') } },
    };
    const { text, buttons: live } = drawn(state);

    expect(text).toContain('Reject, by U1');
    expect(live).toBe(3);
  });

  it('only says it is answered, with the person where known, where no button of the row sets what the answer holds there', () => {
    const answer = { decisions: { a: 'maybe', b: 'maybe' } };

    expect(drawn({ answer, answered: { decisions: { a: by('U1') } } }).text).toContain('Answered by U1');
    expect(drawn({ answer, finished: 'answered' }).text).not.toContain(' by ');
  });

  it('says it is answered with no person where its places were set by different people', () => {
    const answer = { decisions: { a: 'approve', b: 'approve' } };
    const answered = { decisions: { a: by('U1'), b: by('U2') } };
    const { text } = drawn({ answer, answered, finished: 'answered' });

    expect(text.split('\n')).toContain('Answered');
  });

  it('is named for the button that sets all its places, by the person who set them', () => {
    const answer = { decisions: { a: 'approve', b: 'approve' } };
    const answered = { decisions: { a: by('U1'), b: by('U1') } };

    expect(drawn({ answer, answered, finished: 'answered' }).text).toContain('Approve, by U1');
  });

  it('says it is closed where the request ended unanswered, and draws no button', () => {
    const { text, buttons: live } = drawn({ finished: 'closed' });

    expect(text).toContain('Closed without an answer');
    expect(live).toBe(0);
  });

  it('keeps a link button of its row, with no line in its place', () => {
    const { payload } = Result.getOrThrow(slackMessageOf(card, { input, ...moment, finished: 'closed' }));

    expect(JSON.stringify(payload)).toContain('https://example.com');
  });
});

function blocksOf(answered: Schema.Json, finished: 'answered' | 'closed' = 'answered'): string {
  const answer = { decisions: { a: 'approve', b: 'approve' } };
  const { payload } = Result.getOrThrow(slackMessageOf(card, { input, ...moment, answer, answered, finished }));
  return JSON.stringify(payload);
}

const answered = (who: string) => ({ decisions: { a: by(who), b: by(who) } });

describe('a person named in a decided row, for Slack', () => {
  it('is written as a mention where the id has the shape of a member id, and in the plain text as the id', () => {
    const { payload, text } = Result.getOrThrow(
      slackMessageOf(card, {
        input,
        ...moment,
        answer: { decisions: { a: 'approve', b: 'approve' } },
        answered: answered('W0123ABC'),
        finished: 'answered',
      }),
    );

    expect(JSON.stringify(payload)).toContain('Approve, by <@W0123ABC>');
    expect(text).toContain('Approve, by W0123ABC');
    expect(text).not.toContain('<@');
  });

  it.each(['ada', 'u0123', 'U0123 <!channel>', 'U0123|name', '<@U0123>', 'U0123 & co'])(
    'is written as the plain id, with nothing to inject, where %s is no member id',
    (who) => {
      expect(blocksOf(answered(who))).not.toContain(`<@${who}>`);
      expect(blocksOf(answered(who))).toContain(
        `by ${who.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}`,
      );
    },
  );
});
