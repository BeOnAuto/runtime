import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

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
