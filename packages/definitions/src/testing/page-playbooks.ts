import type { Runnable } from '@on.auto/operations';

import type { KeptViews } from '../capability/view-standing.ts';
import { defineRenderPage } from '../operations/render-page.ts';
import { defineRenderPlaybookPage } from '../operations/render-playbook-page.ts';
import { acmeAdmin } from './callers.ts';
import { echoingFunction, echoingWorkflow } from './capabilities/paged.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';
import { keepingNoViews, pagesOver } from './page-ports.ts';

const toAlpha = toPlaybook('acme', 'alpha');

export const greeting = 'greeting: Good morning\ndescription: Drafts the morning posts\n';

function indented(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function workflowWithItsPage(page: string): string {
  return `${greeting}page:\n${indented(page)}\n`;
}

export function functionWithItsPage(page: string, body = '{"greeting": "Hi"}'): string {
  return `---\npage:\n${indented(page)}\n---\n${body}`;
}

const capabilities = [echoingWorkflow, echoingFunction];

export function pageOperationsOver(views: KeptViews) {
  const pages = pagesOver(views);
  return {
    ...definitionOperationsFor(capabilities, undefined, pages),
    renderPage: defineRenderPage(capabilities, pages),
    renderPlaybookPage: defineRenderPlaybookPage(pages),
    pages,
  };
}

export function playbookWithTheWorkflow(views: KeptViews = keepingNoViews) {
  const playbook = harness();
  const operations = pageOperationsOver(views);
  const calling = (operation: { readonly registration: Runnable<'playbook'> }) => (input: object) =>
    playbook.call(operation, toAlpha(acmeAdmin, input));
  const saving = calling(operations.createDefinition);
  return {
    playbook,
    saving,
    updating: calling(operations.updateDefinition),
    reading: calling(operations.getDefinition),
    listing: calling(operations.listDefinitions),
    retiring: calling(operations.retireDefinition),
    running: calling(operations.runDefinition),
    readingRun: calling(operations.getRun),
    rendering: calling(operations.renderPage),
    ready: saving({ type: 'workflow', name: 'morning-social-content', source: greeting }),
  };
}

export const foldingNothing = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '        subject: workflow/morning-social-content',
  '  views:',
  '    by_day: series',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return view;',
  '    }',
].join('\n');

export const resultOfTheGreeting = "result: '{{ output.greeting }} from version {{ run.version }}'";

export const runsOfTheDays = "runs: '{{ views.by_day.lines[0].points | size }} days'";

export const pageOfTheDays = [foldingNothing, "result: '{{ output.greeting }}'", runsOfTheDays].join('\n');
