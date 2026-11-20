import { InvalidInput, type Notice, type PlaybookContext, type PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { workflowSaveNoticesIn } from '../goal-notices/setup-notices-in.ts';
import { playbookGoalsIn } from '../goals/playbook-goals.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { contributesIn } from './contributes-details.ts';
import { contributionIssuesOf } from './contribution-entries.ts';
import { contributionsMisfitWords, contributesWantedWords, goalsWantedAtSaveWordsOf } from './contribution-words.ts';

function goalsWantedAtSave(messages: boolean): InvalidInput {
  const detail = goalsWantedAtSaveWordsOf(messages);
  return new InvalidInput({ detail, issues: [{ pointer: '', detail }] });
}

export function contributionsChecked(
  type: string,
  goals: Parameters<typeof contributionIssuesOf>[0],
  content: DefinitionContent,
): Effect.Effect<DefinitionContent, InvalidInput> {
  if (type !== 'workflow') {
    return Effect.succeed(content);
  }
  const issues = contributionIssuesOf(goals, contributesIn(content.details));
  if (issues.length === 0) {
    return Effect.succeed(content);
  }
  const wanted = issues.some(({ detail }) => detail === contributesWantedWords);
  return Effect.fail(new InvalidInput({ detail: wanted ? contributesWantedWords : contributionsMisfitWords, issues }));
}

export function contributionsGated<E, R>(
  type: string,
  checked: Effect.Effect<DefinitionContent, E, R>,
  messages: boolean,
): Effect.Effect<DefinitionContent, E | InvalidInput, R | PlaybookReader> {
  if (type !== 'workflow') {
    return checked;
  }
  return Effect.flatMap(playbookGoalsIn, ({ goals }) =>
    goals.length === 0
      ? Effect.fail(goalsWantedAtSave(messages))
      : Effect.flatMap(checked, (content) => contributionsChecked(type, goals, content)),
  );
}

export function goalNoticesOfASave(
  type: string,
  goals: boolean,
  stored: StoredDefinition,
): Effect.Effect<readonly Notice[], never, PlaybookReader | PlaybookContext> {
  return goals && type === 'workflow' ? workflowSaveNoticesIn(stored) : Effect.succeed([]);
}
