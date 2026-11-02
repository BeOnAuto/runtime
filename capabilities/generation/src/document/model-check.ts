import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { alternatives, articled } from '@on.auto/phrasing';

import { referenceLimitsOf, type CatalogEntry, type Seconds } from '../catalog/catalog-entry.ts';
import type { GenerationCatalog } from '../catalog/generation-catalog.ts';
import type { GenerationFunctionDefinitionDocument, GenerationParameters } from './generation-document.ts';

interface ChosenModel {
  readonly gateway: string;
  readonly entry: CatalogEntry;
}

export type ModelChoice = { readonly chosen: ChosenModel } | { readonly issues: readonly DocumentIssue[] };

type Choices = readonly string[] | undefined;

interface Choosing {
  readonly lines: SourceLines;
  readonly model: string;
}

function choiceIssue({ lines, model }: Choosing, name: string, given: string | undefined, choices: Choices) {
  if (given === undefined || choices?.includes(given) === true) {
    return [];
  }
  const detail =
    choices === undefined
      ? `${model} takes no ${name}`
      : `${given} is not ${articled(name)} of ${model}, which takes ${alternatives(choices)}`;
  return [issueAt(lines, `/parameters/${name}`, detail)];
}

function secondsIssue({ lines, model }: Choosing, given: number | undefined, seconds: Seconds | undefined) {
  if (given === undefined || (seconds !== undefined && given >= seconds.least && given <= seconds.most)) {
    return [];
  }
  const detail =
    seconds === undefined
      ? `${model} takes no duration`
      : `${model} makes from ${seconds.least} to ${seconds.most} seconds, not ${given}`;
  return [issueAt(lines, '/parameters/duration', detail)];
}

function parameterIssues(choosing: Choosing, entry: CatalogEntry, given: GenerationParameters) {
  if (entry.kind === 'audio') {
    return [
      ...choiceIssue(choosing, 'voice', given.voice, entry.limits.voices),
      ...choiceIssue(choosing, 'format', given.format, entry.limits.formats),
      ...secondsIssue(choosing, given.duration, entry.limits.seconds),
    ];
  }
  const { sizes, aspects } = entry.limits;
  const qualities = entry.kind === 'image' ? entry.limits.qualities : undefined;
  const seconds = entry.kind === 'video' ? entry.limits.seconds : undefined;
  return [
    ...choiceIssue(choosing, 'size', given.size, sizes),
    ...choiceIssue(choosing, 'aspect', given.aspect, aspects),
    ...choiceIssue(choosing, 'quality', given.quality, qualities),
    ...secondsIssue(choosing, given.duration, seconds),
  ];
}

function referenceIssues({ lines, model }: Choosing, entry: CatalogEntry, references: readonly string[]) {
  const limits = referenceLimitsOf(entry);
  const most = limits?.most ?? 0;
  if (references.length <= most) {
    return [];
  }
  const detail = most === 0 ? `${model} takes no references` : `${model} takes at most ${most} references`;
  return [issueAt(lines, '/references', detail)];
}

function modelsOfKind(catalog: GenerationCatalog, document: GenerationFunctionDefinitionDocument): string {
  const models = catalog.entries
    .filter(({ kind, retired }) => kind === document.produces && retired === undefined)
    .map(({ model }) => model);
  return models.length === 0
    ? `the catalogue names no model that produces ${document.produces}`
    : `the catalogue's models that produce ${document.produces} are ${alternatives(models)}`;
}

function entryIssues(
  document: GenerationFunctionDefinitionDocument,
  gateway: string,
  entry: CatalogEntry,
): readonly DocumentIssue[] {
  const { lines } = document;
  if (entry.retired !== undefined) {
    const { on, replacement } = entry.retired;
    return [issueAt(lines, '/model', `${entry.model} was retired on ${on}; name ${gateway}/${replacement} instead`)];
  }
  if (entry.kind !== document.produces) {
    return [issueAt(lines, '/produces', `${entry.model} produces ${entry.kind}, not ${document.produces}`)];
  }
  const choosing = { lines, model: entry.model };
  return [
    ...parameterIssues(choosing, entry, document.parameters),
    ...referenceIssues(choosing, entry, document.references),
  ];
}

export function modelChoiceOf(catalog: GenerationCatalog, document: GenerationFunctionDefinitionDocument): ModelChoice {
  const split = document.model.indexOf('/');
  const gateway = document.model.slice(0, split);
  const model = document.model.slice(split + 1);
  const entry = catalog.entryOf(model);
  if (entry === undefined) {
    return {
      issues: [
        issueAt(
          document.lines,
          '/model',
          `${model} is no model of the catalogue of generation models; ${modelsOfKind(catalog, document)}`,
        ),
      ],
    };
  }
  const issues = entryIssues(document, gateway, entry);
  return issues.length > 0 ? { issues } : { chosen: { gateway, entry } };
}
