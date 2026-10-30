import { counted, listed, plainNumber, quoted, type Noun } from '@on.auto/operations';

import type { RunStatus } from '../reading/run-status.ts';
import type { DefinitionWords } from './definition-words.ts';

export interface RunFilters {
  readonly type?: string;
  readonly name?: string;
  readonly status?: RunStatus;
  readonly cursor?: string;
}

interface Page {
  readonly has_more: boolean;
}

interface ListedRuns extends Page {
  readonly runs: readonly { readonly status: RunStatus }[];
}

const runNoun: Noun = { one: 'run', other: 'runs' };

const moreRemain = ' More remain after these.';

const endingsInWords: Readonly<Record<RunStatus, string>> = {
  started: 'still running',
  succeeded: 'finished',
  rejected: 'did not go through',
  failed: 'broke down',
};

function runsOfWhat(words: DefinitionWords, { type, name }: RunFilters): string {
  if (type === undefined) {
    return name === undefined ? '' : ` of anything named ${quoted(name)}`;
  }
  return name === undefined ? ` of ${words.nounOf(type).other}` : ` of ${words.named(type, name)}`;
}

function filtersInWords(words: DefinitionWords, filters: RunFilters): string {
  const { status } = filters;
  const endedSo = status === undefined ? '' : ` that ${status === 'started' ? 'are ' : ''}${endingsInWords[status]}`;
  return `${runsOfWhat(words, filters)}${endedSo}`;
}

export function runsToList(words: DefinitionWords, filters: RunFilters): string {
  return `list the runs${filtersInWords(words, filters)}`;
}

function howTheyEnded(runs: ListedRuns['runs']): string {
  const endings = Object.entries(endingsInWords).flatMap(([status, ending]: readonly [string, string]) => {
    const count = runs.filter((run) => run.status === status).length;
    return count === 0 ? [] : [`${plainNumber(count)} ${ending}`];
  });
  return `: ${listed(endings)}`;
}

function noRuns(described: string, { has_more }: Page, { cursor }: RunFilters): string {
  if (has_more) {
    return `This page holds no runs${described}, but there are more runs to look through.`;
  }
  if (cursor !== undefined) {
    return `There are no more runs${described}.`;
  }
  return described === '' ? 'This playbook has no runs yet.' : `This playbook has no runs${described}.`;
}

export function runsListed(words: DefinitionWords, page: ListedRuns, filters: RunFilters): string {
  const described = filtersInWords(words, filters);
  const { runs, has_more: hasMore } = page;
  if (runs.length === 0) {
    return noRuns(described, page, filters);
  }
  const endings = filters.status === undefined ? howTheyEnded(runs) : '';
  return `Listed ${counted(runs.length, runNoun)}${described}, newest first${endings}.${hasMore ? moreRemain : ''}`;
}
