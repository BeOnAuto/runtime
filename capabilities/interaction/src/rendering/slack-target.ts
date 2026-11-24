import { toCard } from '@json-render/chat';
import { Result } from 'effect';

import { slackComponents } from './answer-buttons.ts';
import type { ReadonlyDeep } from './readonly-deep.ts';
import { attempted } from './render-failures.ts';
import type { RenderedMessage, RenderState } from './rendered-message.ts';
import { slackMessageOfCard } from './slack-cards.ts';
import { slackLimits } from './slack-limits.ts';
import { withStyledLinksAsButtons } from './styled-links.ts';
import { isList, isRecord } from './written-values.ts';

type WrittenCard = Parameters<typeof toCard>[0];

function isElement(value: unknown): boolean {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }
  const { props, children } = value;
  const propsFit = props === undefined || isRecord(props);
  const childrenFit = children === undefined || (isList(children) && children.every((c) => typeof c === 'string'));
  return propsFit && childrenFit;
}

function isWrittenCard(value: unknown): value is WrittenCard {
  return (
    isRecord(value) &&
    typeof value['root'] === 'string' &&
    isRecord(value['elements']) &&
    Object.values(value['elements']).every((element) => isElement(element))
  );
}

export function slackMessageOf(
  written: unknown,
  state: RenderState,
): Result.Result<RenderedMessage, readonly string[]> {
  const { finished, ...shown } = state;
  const rewritten = withStyledLinksAsButtons(written);
  if (!isWrittenCard(rewritten)) {
    return Result.fail(['The body is not a card: write `root` and `elements`']);
  }
  const writtenCard = { ...rewritten, state: shown };
  const attemptedCard = attempted(() => toCard(writtenCard, { limits: slackLimits, components: slackComponents }));
  return Result.flatMap(attemptedCard, (built: ReadonlyDeep<ReturnType<typeof toCard>>) =>
    slackMessageOfCard(built, {
      answer: shown.answer ?? {},
      answered: shown.answered ?? {},
      ...(finished === undefined ? {} : { over: finished }),
    }),
  );
}
