import type { Outcome } from '@on.auto/operations';
import { PayloadsOutside, mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { PlaybookOperation } from '../operations/definition-operations.ts';
import { definitionFactTypes } from '../registry/definition-events.ts';
import { acmeAdmin } from './callers.ts';
import { echoingFunction, echoingWorkflow } from './capabilities/paged.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { toPlaybook, type Harness } from './harness.ts';

export const savedPlaybook = { org: 'acme', playbook: 'alpha' };

const toAlpha = toPlaybook(savedPlaybook.org, savedPlaybook.playbook);

const savingCapabilities: readonly Capability[] = [echoingWorkflow, echoingFunction];

const operations = definitionOperationsFor(savingCapabilities);

const bytesOfALongText = 2100;

function paddedPast(word: string, bytes: number): string {
  return `${word} ${'and more '.repeat(Math.ceil(bytes / 9))}`.trim();
}

function padded(word: string): string {
  return paddedPast(word, bytesOfALongText);
}

export function longerThanAFactHolds(word: string): string {
  return paddedPast(word, mostInlinePayloadBytes);
}

const triggerLines = [
  'triggers:',
  '  - kind: cron',
  '    reference: /schedule/cron',
  "    expression: '0 9 * * 1'",
  '    time_zone: Europe/Amsterdam',
];

const pageLines = ['page:', '  result: |', '    {{ output.greeting }} said.'];

function workflowSource(greeting: string, comment: string): string {
  return [
    `# ${comment}`,
    `greeting: ${greeting}`,
    'description: Greets each guest',
    'warnings: [The greeting is never checked]',
    ...triggerLines,
    ...pageLines,
    '',
  ].join('\n');
}

function functionSource(greeting: string, comment: string): string {
  const body = { greeting, description: 'Greets each guest', warnings: ['The greeting is never checked'] };
  return ['---', `# ${comment}`, ...pageLines, '---', JSON.stringify(body)].join('\n');
}

export interface SavedTexts {
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
}

interface Saving {
  readonly type: 'workflow' | 'reasoning';
  readonly first: SavedTexts;
  readonly second: SavedTexts;
  readonly small: SavedTexts;
}

const longDiagram = `flowchart LR\n  guest[${padded('A guest')}] --> greet[Greet them]`;

export const savingAWorkflow: Saving = {
  type: 'workflow',
  first: { source: workflowSource('Hi', padded('First')), overview: padded('Greets') },
  second: { source: workflowSource('Hello', padded('Second')) },
  small: { source: workflowSource('Hey', 'Small'), overview: 'Greets briefly' },
};

export function functionDocumentLongerThanAFactHolds(greeting: string): string {
  return functionSource(greeting, longerThanAFactHolds(greeting));
}

export const savingAFunction: Saving = {
  type: 'reasoning',
  first: { source: functionSource('Hi', padded('First')), overview: padded('Greets'), diagram: longDiagram },
  second: { source: functionSource('Hello', padded('Second')), diagram: `${longDiagram}\n  greet --> done[Done]` },
  small: { source: functionSource('Hey', 'Small'), overview: 'Greets briefly', diagram: 'none' },
};

export function askingAbout(definitions: Harness, type: string, name: string, keepsOutside = false) {
  return (operation: PlaybookOperation, input: object = {}): Promise<Outcome> =>
    definitions.run(
      definitions
        .dispatch(operation, toAlpha(acmeAdmin, { type, name, ...input }))
        .pipe(Effect.provideService(PayloadsOutside, keepsOutside)),
    );
}

export async function everyWayOfSaving(
  definitions: Harness,
  saving: Saving,
  keepsOutside = false,
): Promise<readonly Outcome[]> {
  const asked = askingAbout(definitions, saving.type, `greet-${saving.type}`, keepsOutside);
  const { first, second, small } = saving;
  return [
    await asked(operations.createDefinition, first),
    await asked(operations.updateDefinition, second),
    await asked(operations.updateDefinition, { ...second, overview: first.overview }),
    await asked(operations.updateDefinition, small),
    await asked(operations.pauseDefinition),
    await asked(operations.resumeDefinition),
    await asked(operations.retireDefinition),
    await asked(operations.restoreDefinition),
    await asked(operations.updateDefinition, first),
  ];
}

const definitionFacts: ReadonlySet<string> = new Set(definitionFactTypes);

export async function definitionFactsStored(definitions: Harness): Promise<readonly string[]> {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(savedPlaybook, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  return records
    .filter(({ type }) => definitionFacts.has(type))
    .map(({ type, data }) => JSON.stringify({ type, data }));
}

export { operations as savingOperations };
