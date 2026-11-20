import { defineCommand } from '@on.auto/operations';
import { Effect, Option, Result, Schema } from 'effect';

import { experiments, textOf } from '../goals/goal-examples.ts';
import { goalsDocumentOf } from '../goals/goals-check.ts';
import { playbookGoalsSaved } from '../goals/goals-saved.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { pageData, pageMappingOf, runsOfTheDayChart } from '../testing/pages.ts';

export const savedGoals = textOf([experiments]);

export const savedPage = pageMappingOf({ data: pageData(), runs: runsOfTheDayChart });

export const savePlaybook = defineCommand('playbook', {
  name: 'save_playbook',
  title: 'Save playbook',
  description: 'Saves the page and the goals of the playbook, as update_playbook does.',
  route: { method: 'POST', path: '/saved' },
  inputSchema: Schema.Struct({ page: Schema.String, goals: Schema.String }),
  outputSchema: Schema.Struct({ saved: Schema.Boolean }),
  reasons: ['invalid_input', 'conflict', 'unavailable'],
  handle: Effect.fnUntraced(function* ({ page, goals }) {
    const content = yield* uncheckedPages.check(page, 'playbook');
    yield* uncheckedPages.savePlaybookPage({
      source: page,
      content: Option.getOrThrow(Option.fromNullishOr(content)),
    });
    yield* playbookGoalsSaved({ document: Result.getOrThrow(goalsDocumentOf(goals)), assessed: new Set() });
    return { saved: true };
  }),
});
