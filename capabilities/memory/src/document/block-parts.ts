import { issueAt, type SourceLines } from '@on.auto/definitions/document';
import { Result } from 'effect';

import type { MemoryScope } from '../facts/memory-facts.ts';
import type { WrittenAbout, WrittenRecall, WrittenRemember } from './front-matter.ts';
import {
  aboutProblem,
  dayProblem,
  expiryProblem,
  memoryBounds,
  memoryIdProblem,
  recalledCharactersProblem,
  tagCountProblem,
  tagProblem,
  textProblem,
  wordsProblem,
} from './memory-bounds.ts';
import type { RecallBlock, RememberBlock, WrittenSpan, WrittenText } from './memory-document.ts';
import { memoryScopeOf, playbookScopeOf, recallScopeOf, type RecallScope } from './memory-scopes.ts';
import {
  allOf,
  isLiteral,
  issuesAcross,
  issuesOf,
  writtenText,
  type Checked,
  type WrittenPlace,
} from './written-fields.ts';

function writtenOrNot<Written, Part>(
  written: Written | undefined,
  part: (written: Written) => Checked<Part>,
): Checked<Partial<Part>> {
  return written === undefined ? Result.succeed({}) : part(written);
}

interface PlacedTag {
  readonly tag: string;
  readonly index: number;
}

function firstOfEach(tags: readonly string[]): readonly PlacedTag[] {
  return tags.flatMap((tag, index) => (tags.indexOf(tag) === index ? [{ tag, index }] : []));
}

function tagsOf(written: readonly string[], pointer: string, place: WrittenPlace): Checked<readonly WrittenText[]> {
  const tags = firstOfEach(written);
  const counted = tagCountProblem(tags.length);
  const each = allOf(tags, ({ tag, index }) => writtenText(tag, `${pointer}/${index}`, place, tagProblem));
  return counted === undefined ? each : Result.fail([issueAt(place.lines, pointer, counted), ...issuesOf(() => each)]);
}

function scopeAt<Scope>(
  written: string | undefined,
  pointer: string,
  lines: SourceLines,
  scoped: { readonly read: (written: string) => Result.Result<Scope, string>; readonly otherwise: Scope },
): Checked<Scope> {
  return written === undefined
    ? Result.succeed(scoped.otherwise)
    : Result.mapError(scoped.read(written), (problem) => [issueAt(lines, pointer, problem)]);
}

function spanOf(about: WrittenAbout, place: WrittenPlace): Checked<{ readonly about: WrittenSpan }> {
  const from = writtenText(about.from, '/remember/about/from', place, dayProblem);
  const to = writtenText(about.to, '/remember/about/to', place, dayProblem);
  const days = issuesAcross([() => from, () => to]);
  const spanProblem =
    days.length === 0 && isLiteral(about.from) && isLiteral(about.to) ? aboutProblem(about) : undefined;
  const issues = [
    ...days,
    ...(spanProblem === undefined ? [] : [issueAt(place.lines, '/remember/about', spanProblem)]),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(Result.all({ from, to }), (span: WrittenSpan) => ({ about: span }));
}

interface RememberParts {
  readonly text: WrittenText;
  readonly tags: readonly WrittenText[];
  readonly scope: MemoryScope;
  readonly about: { readonly about?: WrittenSpan };
  readonly expires: { readonly expires?: WrittenText };
  readonly replaces: { readonly replaces?: WrittenText };
}

interface RecallParts {
  readonly words: { readonly words?: WrittenText };
  readonly tags: readonly WrittenText[];
  readonly scope: RecallScope;
  readonly mostCharacters: number;
}

export function rememberBlockOf(written: WrittenRemember, place: WrittenPlace): Checked<RememberBlock> {
  const text = writtenText(written.text, '/remember/text', place, textProblem);
  const tags = tagsOf(written.tags ?? [], '/remember/tags', place);
  const scope = scopeAt<MemoryScope>(written.scope, '/remember/scope', place.lines, {
    read: place.organizationKept ? memoryScopeOf : playbookScopeOf,
    otherwise: 'playbook',
  });
  const about = writtenOrNot(written.about, (span) => spanOf(span, place));
  const expires = writtenOrNot(written.expires, (each) =>
    Result.map(writtenText(each, '/remember/expires', place, expiryProblem), (expiry) => ({ expires: expiry })),
  );
  const replaces = writtenOrNot(written.replaces, (each) =>
    Result.map(writtenText(each, '/remember/replaces', place, memoryIdProblem), (id) => ({ replaces: id })),
  );
  const issues = issuesAcross([() => text, () => tags, () => scope, () => about, () => expires, () => replaces]);
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  return Result.map(Result.all({ text, tags, scope, about, expires, replaces }), (parts: RememberParts) => ({
    text: parts.text,
    tags: parts.tags,
    scope: parts.scope,
    ...parts.about,
    ...parts.expires,
    ...parts.replaces,
  }));
}

function charactersAt(mostCharacters: number, lines: SourceLines): Checked<number> {
  const problem = recalledCharactersProblem(mostCharacters);
  return problem === undefined
    ? Result.succeed(mostCharacters)
    : Result.fail([issueAt(lines, '/recall/most_characters', problem)]);
}

export function recallBlockOf(written: WrittenRecall, place: WrittenPlace): Checked<RecallBlock> {
  const words = writtenOrNot(written.words, (each) =>
    Result.map(writtenText(each, '/recall/words', place, wordsProblem), (asked) => ({ words: asked })),
  );
  const tags = tagsOf(written.tags ?? [], '/recall/tags', place);
  const scope = scopeAt<RecallScope>(written.scope, '/recall/scope', place.lines, {
    read: recallScopeOf,
    otherwise: 'both',
  });
  const mostCharacters = charactersAt(written.most_characters ?? memoryBounds.defaultRecalledCharacters, place.lines);
  const issues = issuesAcross([() => words, () => tags, () => scope, () => mostCharacters]);
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  return Result.map(Result.all({ words, tags, scope, mostCharacters }), (parts: RecallParts) => ({
    ...parts.words,
    tags: parts.tags,
    scope: parts.scope,
    mostCharacters: parts.mostCharacters,
  }));
}
