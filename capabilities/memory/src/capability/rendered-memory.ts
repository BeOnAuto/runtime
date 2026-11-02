import { Conflict, type InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import {
  aboutProblem,
  dayProblem,
  distinctTags,
  expiryOf,
  memoryIdProblem,
  tagProblem,
  textProblem,
  wordsProblem,
  type About,
} from '../document/memory-bounds.ts';
import type { RememberBlock, WrittenSpan, WrittenText } from '../document/memory-document.ts';
import type { AskedMemory } from '../facts/memory-decider.ts';
import { checkedRendered, renderedAndChecked, renderedText, type Rendering } from './rendered-text.ts';

export function renderedTags(
  { tags }: { readonly tags: readonly WrittenText[] },
  rendering: Rendering,
): Effect.Effect<readonly string[], InvalidInput | Conflict> {
  return Effect.map(
    Effect.forEach(tags, (tag) => renderedAndChecked(tag, rendering, tagProblem)),
    distinctTags,
  );
}

const renderedSpan = Effect.fnUntraced(function* (about: WrittenSpan, rendering: Rendering) {
  const from = yield* renderedAndChecked(about.from, rendering, dayProblem);
  const to = yield* renderedAndChecked(about.to, rendering, dayProblem);
  const problem = aboutProblem({ from, to });
  const span: About = { from, to };
  return problem === undefined
    ? span
    : yield* new Conflict({ detail: problem, kind: 'unworkable', record: { pointer: about.to.pointer } });
});

function renderedAbout(
  { about }: RememberBlock,
  rendering: Rendering,
): Effect.Effect<About | undefined, InvalidInput | Conflict> {
  return about === undefined ? Effect.undefined : renderedSpan(about, rendering);
}

function expiryAfter(
  written: WrittenText,
  rendering: Rendering,
  now: number,
): Effect.Effect<string, InvalidInput | Conflict> {
  return Effect.flatMap(renderedText(written, rendering), (text) =>
    Result.match(expiryOf(text), {
      onSuccess: (milliseconds) => Effect.succeed(new Date(now + milliseconds).toISOString()),
      onFailure: (problem) => checkedRendered(text, written, () => problem),
    }),
  );
}

function renderedExpiry(
  { expires }: RememberBlock,
  rendering: Rendering,
  now: number,
): Effect.Effect<string | undefined, InvalidInput | Conflict> {
  return expires === undefined ? Effect.undefined : expiryAfter(expires, rendering, now);
}

export const renderedMemory = Effect.fnUntraced(function* (block: RememberBlock, rendering: Rendering, now: number) {
  const text = yield* renderedAndChecked(block.text, rendering, textProblem);
  const tags = yield* renderedTags(block, rendering);
  const about = yield* renderedAbout(block, rendering);
  const expiresAt = yield* renderedExpiry(block, rendering, now);
  const memory: AskedMemory = {
    text,
    tags,
    ...(about === undefined ? {} : { about }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
  return memory;
});

export function renderedReplaces(
  { replaces }: RememberBlock,
  rendering: Rendering,
): Effect.Effect<string | undefined, InvalidInput | Conflict> {
  return replaces === undefined ? Effect.undefined : renderedAndChecked(replaces, rendering, memoryIdProblem);
}

export function renderedWords(
  { words }: { readonly words?: WrittenText },
  rendering: Rendering,
): Effect.Effect<string, InvalidInput | Conflict> {
  return words === undefined ? Effect.succeed('') : renderedAndChecked(words, rendering, wordsProblem);
}
