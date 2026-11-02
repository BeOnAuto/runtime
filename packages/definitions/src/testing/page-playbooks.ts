import type { Runnable } from '@on.auto/operations';

import type { KeptViews } from '../capability/view-standing.ts';
import { acmeAdmin } from './callers.ts';
import { harness, toPlaybook } from './harness.ts';
import { keepingNoViews, pageOperationsOver } from './page-ports.ts';

const toAlpha = toPlaybook('acme', 'alpha');

export const greeting = '{"greeting": "Good morning", "description": "Drafts the morning posts"}';

export function playbookWithTheWorkflow(views: KeptViews = keepingNoViews) {
  const playbook = harness();
  const operations = pageOperationsOver(views);
  const { createDefinition, updateDefinition, getDefinition, retireDefinition, runDefinition, getRun, renderPage } =
    operations;
  const calling = (operation: { readonly registration: Runnable<'playbook'> }) => (input: object) =>
    playbook.call(operation, toAlpha(acmeAdmin, input));
  const saving = calling(createDefinition);
  return {
    playbook,
    asked: (input: object) => toAlpha(acmeAdmin, input),
    saving,
    updating: calling(updateDefinition),
    reading: calling(getDefinition),
    retiring: calling(retireDefinition),
    running: calling(runDefinition),
    readingRun: calling(getRun),
    rendering: calling(renderPage),
    ready: saving({ type: 'workflow', name: 'morning-social-content', source: greeting }),
  };
}

export function refusedAtTheSource(detail: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The page has a problem',
    issues: [{ pointer: '/source', detail }],
  };
}
