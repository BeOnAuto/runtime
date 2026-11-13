import type {
  SlackCardChild,
  SlackCardElement,
  SlackChartDefinition,
  SlackFieldElement,
  SlackLinkButtonElement,
} from '@chat-adapter/slack/blocks';
import { cardToBlockKit, cardToFallbackText } from '@chat-adapter/slack/blocks';
import type { CardChild, CardElement, ChartDefinition } from 'chat';
import { Result, type Schema } from 'effect';

import { jsonOf } from './json-values.ts';
import type { ReadonlyDeep } from './readonly-deep.ts';
import { attempted } from './render-failures.ts';
import type { RenderedMessage } from './rendered-message.ts';
import { slackShows } from './slack-limits.ts';

type Child = ReadonlyDeep<CardChild>;
type Chart = ReadonlyDeep<ChartDefinition>;
type Issues = readonly string[];

function unsupported(what: string): Result.Result<never, Issues> {
  return Result.fail([`Slack cannot show ${what} here: write only ${slackShows}`]);
}

function linkButtonsOf(children: ReadonlyDeep<CardChild & { type: 'actions' }>['children']) {
  return Result.all(
    children.map((button): Result.Result<SlackLinkButtonElement, Issues> => {
      if (button.type !== 'link-button') {
        return unsupported(`a ${button.type} in actions`);
      }
      return Result.succeed({ type: 'link-button', label: button.label, url: button.url });
    }),
  );
}

function chartOf(chart: Chart): SlackChartDefinition {
  if (chart.type === 'pie') {
    return { type: 'pie', segments: chart.segments.map(({ label, value }) => ({ label, value })) };
  }
  return {
    type: chart.type,
    categories: [...chart.categories],
    series: chart.series.map(({ name, data }) => ({ name, data: data.map(({ label, value }) => ({ label, value })) })),
    ...(chart.xLabel === undefined ? {} : { xLabel: chart.xLabel }),
    ...(chart.yLabel === undefined ? {} : { yLabel: chart.yLabel }),
  };
}

function fieldsOf(children: readonly ReadonlyDeep<{ label: string; value: string }>[]): SlackFieldElement[] {
  return children.map(({ label, value }) => ({ type: 'field', label, value }));
}

type Leaf = Extract<Child, { type: 'text' | 'image' | 'table' | 'chart' | 'fields' }>;

function textOf(child: ReadonlyDeep<Extract<CardChild, { type: 'text' }>>): SlackCardChild {
  return { type: 'text', content: child.content, ...(child.style === undefined ? {} : { style: child.style }) };
}

function imageOf(child: ReadonlyDeep<Extract<CardChild, { type: 'image' }>>): SlackCardChild {
  return { type: 'image', url: child.url, ...(child.alt === undefined ? {} : { alt: child.alt }) };
}

function tableOf(child: ReadonlyDeep<Extract<CardChild, { type: 'table' }>>): SlackCardChild {
  return {
    type: 'table',
    headers: [...child.headers],
    rows: child.rows.map((row) => [...row]),
    ...(child.align === undefined ? {} : { align: [...child.align] }),
    ...(child.caption === undefined ? {} : { caption: child.caption }),
  };
}

function leafOf(child: Leaf): SlackCardChild {
  if (child.type === 'text') {
    return textOf(child);
  }
  if (child.type === 'image') {
    return imageOf(child);
  }
  if (child.type === 'table') {
    return tableOf(child);
  }
  if (child.type === 'fields') {
    return { type: 'fields', children: fieldsOf(child.children) };
  }
  return { type: 'chart', title: child.title, chart: chartOf(child.chart) };
}

function slackChildrenOf(children: readonly Child[]): Result.Result<SlackCardChild[], Issues> {
  const converted: SlackCardChild[] = [];
  for (const child of children) {
    const slackChild = slackChildOf(child);
    if (Result.isFailure(slackChild)) {
      return Result.fail(slackChild.failure);
    }
    converted.push(slackChild.success);
  }
  return Result.succeed(converted);
}

function sectionOf(children: readonly Child[]): Result.Result<SlackCardChild, Issues> {
  const inner = slackChildrenOf(children);
  return Result.isFailure(inner)
    ? Result.fail(inner.failure)
    : Result.succeed({ type: 'section', children: inner.success });
}

function actionsOf(children: ReadonlyDeep<Extract<CardChild, { type: 'actions' }>>['children']) {
  const buttons = linkButtonsOf(children);
  return Result.isFailure(buttons)
    ? Result.fail(buttons.failure)
    : Result.succeed<SlackCardChild>({ type: 'actions', children: buttons.success });
}

const leafTypes = new Set<string>(['text', 'image', 'table', 'fields', 'chart']);

function isLeaf(child: Child): child is Leaf {
  return leafTypes.has(child.type);
}

function slackChildOf(child: Child): Result.Result<SlackCardChild, Issues> {
  if (isLeaf(child)) {
    return Result.succeed(leafOf(child));
  }
  if (child.type === 'divider') {
    return Result.succeed({ type: 'divider' });
  }
  if (child.type === 'link') {
    return Result.succeed({ type: 'link', label: child.label, url: child.url });
  }
  if (child.type === 'actions') {
    return actionsOf(child.children);
  }
  if (child.type === 'section') {
    return sectionOf(child.children);
  }
  return unsupported('a text input');
}

export function slackCardOf(card: ReadonlyDeep<CardElement>): Result.Result<SlackCardElement, Issues> {
  const children = slackChildrenOf(card.children);
  if (Result.isFailure(children)) {
    return Result.fail(children.failure);
  }
  return Result.succeed({
    type: 'card',
    children: children.success,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.subtitle === undefined ? {} : { subtitle: card.subtitle }),
    ...(card.imageUrl === undefined ? {} : { imageUrl: card.imageUrl }),
  });
}

export function slackMessageOfCard(card: ReadonlyDeep<CardElement>): Result.Result<RenderedMessage, Issues> {
  const slackCard = slackCardOf(card);
  if (Result.isFailure(slackCard)) {
    return Result.fail(slackCard.failure);
  }
  const blocks = attempted(() => cardToBlockKit(slackCard.success));
  return Result.flatMap(blocks, (made: readonly unknown[]) =>
    Result.map(jsonOf(made, 'The Block Kit message'), (payload: Schema.Json) => ({
      payload,
      text: cardToFallbackText(slackCard.success),
    })),
  );
}
