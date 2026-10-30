import { withoutTrailingSlashes } from '@on.auto/config';
import { counted, listed, type Noun } from '@on.auto/operations';

import { aliasPatternOf } from '../model/model-alias.ts';
import type { ModelEntry, ModelList } from './model-list.ts';

const modelNoun: Noun = { one: 'model', other: 'models' };

const mostNamed = 20;

const everythingToTheLastSlash = /^.*\//u;

function lastPartOf(text: string): string {
  return withoutTrailingSlashes(text).replace(everythingToTheLastSlash, '');
}

function nameOf({ id, name }: ModelEntry): string {
  return name ?? lastPartOf(id);
}

function isRepeated(labels: readonly string[], label: string): boolean {
  return labels.indexOf(label) !== labels.lastIndexOf(label);
}

interface Labelled {
  readonly entry: ModelEntry;
  readonly label: string;
}

function namedApart(entries: readonly ModelEntry[]): readonly string[] {
  const named = entries.map((entry): Labelled => ({ entry, label: nameOf(entry) }));
  const names = named.map(({ label }: Labelled) => label);
  const labelled = named.map(({ entry, label }: Labelled): Labelled => ({
    entry,
    label: isRepeated(names, label) ? `${label} (${entry.owned_by})` : label,
  }));
  const labels = labelled.map(({ label }: Labelled) => label);
  return labelled.map(({ entry, label }: Labelled) => (isRepeated(labels, label) ? lastPartOf(entry.id) : label));
}

function anyModelOf({ id }: ModelEntry): string {
  const prefix = aliasPatternOf(id).prefix;
  const split = prefix.indexOf('/');
  const provider = prefix.slice(0, split);
  const start = prefix.slice(split + 1);
  return start === '' ? `any ${provider} model` : `any ${provider} model starting with ${lastPartOf(start)}`;
}

function namesOf(entries: readonly ModelEntry[]): string {
  const named = namedApart(entries.slice(0, mostNamed));
  const others = entries.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

function providersOf(entries: readonly ModelEntry[]): string {
  return listed([...new Set(entries.map(({ owned_by: ownedBy }) => ownedBy))]);
}

function modelsWords(models: readonly ModelEntry[]): string {
  return models.length === 0
    ? ''
    : `This server can call ${counted(models.length, modelNoun)} through ${providersOf(models)}: ${namesOf(models)}.`;
}

function patternWords(patterns: readonly ModelEntry[], afterModels: boolean): string {
  if (patterns.length === 0) {
    return '';
  }
  const opening = afterModels ? 'It can also call' : 'This server can call';
  return `${opening} ${listed(patterns.map((entry) => anyModelOf(entry)))}.`;
}

function nothingWords(provider: string | undefined, providerSetup: string | undefined): string {
  if (provider !== undefined) {
    return `This server has no model it can call through ${provider}.`;
  }
  return providerSetup === undefined
    ? 'This server has no model it can call.'
    : `This server has no model it can call. ${providerSetup}`;
}

const allowedOnly = 'It lists only the models its operator allows.';

const incomplete = 'The list may be incomplete: a provider could not be asked just now.';

export function modelsListed(
  { data, catalog_status: status, narrowed }: ModelList,
  provider?: string,
  providerSetup?: string,
): string {
  const models = data.filter(({ pattern }) => pattern !== true);
  const patterns = data.filter(({ pattern }) => pattern === true);
  const words = [
    data.length === 0 ? nothingWords(provider, providerSetup) : modelsWords(models),
    patternWords(patterns, models.length > 0),
    narrowed ? allowedOnly : '',
    status === 'partial' ? incomplete : '',
  ];
  return words.filter((sentence) => sentence !== '').join(' ');
}
