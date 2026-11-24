import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerButtonsOf } from './answer-buttons.ts';
import type { RenderState } from './rendered-message.ts';
import { slackMessageOf } from './slack-target.ts';
import { isList, isRecord } from './written-values.ts';

const state: RenderState = {
  input: {
    reportUrl: 'https://example.com/report',
    bad: 'not a url',
    links: [
      { name: 'One', url: 'https://example.com/1' },
      { name: 'Two', url: 'https://example.com/2' },
    ],
  },
  today: '2026-10-07',
  now: '2026-10-07T09:00:00.000Z',
};

function cardOf(links: Readonly<Record<string, unknown>>) {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: 'Orders' }, children: ['actions'] },
      actions: { type: 'Actions', props: {}, children: Object.keys(links) },
      ...links,
    },
  };
}

function linkOf(props: Readonly<Record<string, unknown>>) {
  return { type: 'LinkButton', props };
}

function buttonsOf(payload: Schema.Json): readonly unknown[] {
  const blocks = isList(payload) ? payload : [];
  const actions = blocks.find((block) => isRecord(block) && block['type'] === 'actions');
  return isRecord(actions) && isList(actions['elements']) ? actions['elements'] : [];
}

function renderedButtons(written: unknown): readonly unknown[] {
  const message = slackMessageOf(written, state);
  return Result.isSuccess(message) ? buttonsOf(message.success.payload) : [];
}

function issuesOf(written: unknown): readonly string[] {
  const message = slackMessageOf(written, state);
  return Result.isFailure(message) ? message.failure : [];
}

const reportButton = {
  type: 'button',
  action_id: 'link-https://example.com/report',
  text: { type: 'plain_text', text: 'Open the report', emoji: true },
  url: 'https://example.com/report',
  style: 'primary',
};

describe('a LinkButton with a style, rendered for Slack', () => {
  it('shows the primary link in colour and the plain one with no style', () => {
    const card = cardOf({
      report: linkOf({ label: 'Open the report', url: { $state: '/input/reportUrl' }, style: 'primary' }),
      guide: linkOf({ label: 'Read the guide', url: 'https://example.com/guide' }),
    });

    expect(renderedButtons(card)).toEqual([
      reportButton,
      {
        type: 'button',
        action_id: 'link-https://example.com/guide',
        text: { type: 'plain_text', text: 'Read the guide', emoji: true },
        url: 'https://example.com/guide',
      },
    ]);
  });

  it('shows a danger link in red', () => {
    const card = cardOf({ wipe: linkOf({ label: 'Wipe the data', url: 'https://example.com/wipe', style: 'danger' }) });

    expect(renderedButtons(card)).toMatchObject([{ url: 'https://example.com/wipe', style: 'danger' }]);
  });

  it('shows a repeated link in colour, one for each item', () => {
    const each = linkOf({ label: { $item: 'name' }, url: { $item: 'url' }, style: 'primary' });
    const card = cardOf({ each });
    const repeating = { ...card.elements.actions, repeat: { statePath: '/input/links' } };

    expect(renderedButtons({ ...card, elements: { ...card.elements, actions: repeating } })).toMatchObject([
      { text: { text: 'One' }, url: 'https://example.com/1', style: 'primary' },
      { text: { text: 'Two' }, url: 'https://example.com/2', style: 'primary' },
    ]);
  });
});

describe('a styled LinkButton whose address is wrong', () => {
  const refusal = ['The url of a LinkButton must be a web address'];

  it('is refused when the address is not one, as a LinkButton with no style is', () => {
    const styled = cardOf({ go: linkOf({ label: 'Go', url: { $state: '/input/bad' }, style: 'primary' }) });
    const plain = cardOf({ go: linkOf({ label: 'Go', url: { $state: '/input/bad' } }) });

    expect(issuesOf(styled)).toEqual(refusal);
    expect(issuesOf(plain)).not.toEqual([]);
  });

  it('is refused when it has no address', () => {
    expect(issuesOf(cardOf({ go: linkOf({ label: 'Go', style: 'primary' }) }))).toEqual(refusal);
  });

  it('is refused when it has no props', () => {
    expect(issuesOf(cardOf({ go: { type: 'LinkButton' } }))).not.toEqual([]);
  });
});

describe('a Button written in a card', () => {
  it('is refused at the run, whatever its style', () => {
    const card = cardOf({ yes: { type: 'Button', props: { id: 'yes', label: 'Yes', style: 'primary' } } });

    expect(issuesOf(card)).toEqual([
      'Slack cannot show a button in actions here: write only text, image, divider, fields, table, chart and link buttons',
    ]);
  });
});

const answerButtons = {
  approve: {
    type: 'Button',
    props: { label: 'Approve', style: 'primary', once: true, sets: [{ at: '/choice', value: 'approve' }] },
  },
  reject: { type: 'Button', props: { label: 'Reject', sets: [{ at: '/choice', value: 'reject' }] } },
};

function answerCard() {
  return cardOf(answerButtons);
}

function answerCardWith(note: Readonly<Record<string, unknown>>) {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: 'Orders' }, children: ['actions', 'note'] },
      actions: { type: 'Actions', children: ['approve', 'reject'] },
      ...answerButtons,
      note: { type: 'Text', ...note },
    },
  };
}

function actionIdsOf(card: unknown, drawn: Partial<RenderState> = {}): readonly string[] {
  const rendered = slackMessageOf(card, { ...state, ...drawn });
  return Result.isSuccess(rendered) ? (JSON.stringify(rendered.success.payload).match(/auto-answer:\w+/gu) ?? []) : [];
}

describe('a Button that sets parts of the answer, rendered for Slack', () => {
  it('shows a button for each, named by what it sets, and keeps what each sets apart from the message', () => {
    const rendered = Result.getOrThrow(slackMessageOf(answerCard(), state));

    expect(rendered.buttons).toMatchObject([
      { sets: [{ at: '/choice', value: 'approve' }], once: true },
      { sets: [{ at: '/choice', value: 'reject' }] },
    ]);
    expect(JSON.stringify(rendered.payload)).not.toContain('"value"');
    expect(JSON.stringify(rendered.payload)).toContain('"style":"primary"');
  });

  it('names a button by its label and what it sets, so a card drawn again names it the same', () => {
    expect(actionIdsOf(answerCard())).toEqual(actionIdsOf(answerCard(), { answer: { choice: 'x' } }));
  });

  it('shows no button where the request is over, whatever the card says', () => {
    expect(actionIdsOf(answerCard(), { finished: 'answered' })).toEqual([]);
    expect(slackMessageOf('Hello', { ...state, finished: 'answered' })).toEqual(
      Result.fail(['The body is not a card: write `root` and `elements`']),
    );
    expect(slackMessageOf({ root: 'card', elements: [] }, { ...state, finished: 'answered' })).toEqual(
      Result.fail(['The body is not a card: write `root` and `elements`']),
    );
  });
});

describe('a Button that sets parts of the answer, as the answer is given', () => {
  it('shows no button with once where a place it sets is decided, nor a row left with none', () => {
    const decided = { answered: { choice: { by: 'ada', at: 'then' } } };

    expect(actionIdsOf(answerCard())).toHaveLength(2);
    expect(actionIdsOf(answerCard(), decided)).toHaveLength(1);
  });

  it('reads the answer so far and who set each part', () => {
    const card = answerCardWith({ props: { content: { $template: 'By ${/answered/choice/by}: ${/answer/choice}' } } });
    const answered = { choice: { by: 'ada', at: 't' } };

    expect(
      Result.getOrThrow(slackMessageOf(card, { ...state, answer: { choice: 'approve' }, answered })).text,
    ).toContain('By ada: approve');
  });

  it('shows an element only where its visible condition holds', () => {
    const card = answerCardWith({ props: { content: 'Decided' }, visible: { $state: '/answered/choice/by' } });
    const answered = { choice: { by: 'ada', at: 't' } };

    expect([
      Result.getOrThrow(slackMessageOf(card, state)).text,
      Result.getOrThrow(slackMessageOf(card, { ...state, answered })).text,
    ]).toEqual([expect.not.stringContaining('Decided'), expect.stringContaining('Decided')]);
  });
});

function button(id: string, value: string) {
  return { type: 'button' as const, id, label: 'Go', value };
}

describe('the buttons of a built card', () => {
  it('are only those whose id and what they set the run made, and each once', () => {
    const sets = JSON.stringify({ sets: [{ at: '/a', value: 1 }], once: false });
    const card = {
      type: 'card' as const,
      children: [
        {
          type: 'actions' as const,
          children: [
            button('auto-answer:1', sets),
            button('auto-answer:1', sets),
            button('auto-answer:2', 'forged'),
            button('other', sets),
          ],
        },
        { type: 'divider' as const },
      ],
    };

    expect(answerButtonsOf(card)).toEqual([{ id: 'auto-answer:1', label: 'Go', sets: [{ at: '/a', value: 1 }] }]);
  });
});
