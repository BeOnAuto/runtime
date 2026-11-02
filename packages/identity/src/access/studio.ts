import type { DefinitionSaved, StudioPage } from '@on.auto/operations';

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

function pageParametersOf(page: StudioPage | undefined): Parameter[] {
  if (page === undefined) {
    return [];
  }
  const playbook: Parameter = ['playbook', page.playbook];
  if (page.kind === 'definition') {
    return [playbook, [page.type, page.name], ...becauseOf(page.saved), ['version', String(page.version)]];
  }
  return page.kind === 'run' ? [playbook, ['run', page.run]] : [playbook];
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
    ['src', openedFrom],
    ...(installId === undefined ? [] : [['install', installId]]),
    ...pageParametersOf(page),
  ]);
  return `${studioBaseOf(studio, ownOrigin)}?${query.toString()}`;
}
