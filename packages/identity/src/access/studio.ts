import type { CommentedPlace, DefinitionSaved, StudioPage } from '@on.auto/operations';

export const defaultStudioOrigin = 'https://studio.on.auto';

export const servedStudioPath = '/studio/';

export interface StudioSettings {
  readonly origin: string;
  readonly served: boolean;
}

type StudioOpenedFrom = 'terminal' | 'runtime-page' | 'agent';

interface StudioOpening {
  readonly ownOrigin: string;
  readonly openedFrom: StudioOpenedFrom;
  readonly installId: string | undefined;
  readonly page?: StudioPage | undefined;
}

type Parameter = [string, string];

function becauseOf(saved: DefinitionSaved | undefined): Parameter[] {
  return saved === undefined ? [] : [['because', saved]];
}

function namedIf(name: string, value: string | number | undefined): Parameter[] {
  return value === undefined ? [] : [[name, String(value)]];
}

function placeParametersOf(place: CommentedPlace): Parameter[] {
  if (place.kind === 'definition') {
    return [[place.type, place.name], ['version', String(place.version)], ...namedIf('step', place.step)];
  }
  return place.kind === 'run'
    ? [['run', place.run], ...namedIf('event', place.event), ...namedIf('block', place.block)]
    : [];
}

function pageParametersOf(page: StudioPage | undefined): Parameter[] {
  if (page === undefined) {
    return [];
  }
  if (page.kind === 'org_comment') {
    return [...namedIf('settings', page.settings), ['comment', page.comment]];
  }
  const playbook: Parameter = ['playbook', page.playbook];
  if (page.kind === 'definition') {
    return [playbook, [page.type, page.name], ...becauseOf(page.saved), ['version', String(page.version)]];
  }
  if (page.kind === 'comment') {
    return [playbook, ...placeParametersOf(page.on), ['comment', page.comment]];
  }
  return page.kind === 'run' ? [playbook, ['run', page.run]] : [playbook];
}

function arrivalOf(
  openedFrom: StudioOpenedFrom,
  installId: string | undefined,
  page: StudioPage | undefined,
): Parameter[] {
  if (page?.kind === 'comment' || page?.kind === 'org_comment') {
    return [];
  }
  return [['src', openedFrom], ...(installId === undefined ? [] : [['install', installId] satisfies Parameter])];
}

export function studioBaseOf({ origin, served }: StudioSettings, ownOrigin: string): string {
  return served ? `${ownOrigin}${servedStudioPath}` : `${origin}/`;
}

export function studioLinkOf(
  studio: StudioSettings,
  { ownOrigin, openedFrom, installId, page }: StudioOpening,
): string {
  const query = new URLSearchParams([
    ['server', ownOrigin],
    ...arrivalOf(openedFrom, installId, page),
    ...pageParametersOf(page),
  ]);
  return `${studioBaseOf(studio, ownOrigin)}?${query.toString()}`;
}
