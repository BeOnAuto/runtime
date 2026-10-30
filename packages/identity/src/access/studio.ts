export const defaultStudioOrigin = 'https://studio.on.auto';

export const servedStudioPath = '/studio/';

export interface StudioSettings {
  readonly origin: string;
  readonly served: boolean;
}

type StudioOpenedFrom = 'terminal' | 'runtime-page';

interface StudioOpening {
  readonly ownOrigin: string;
  readonly openedFrom: StudioOpenedFrom;
  readonly installId: string | undefined;
}

export function studioBaseOf({ origin, served }: StudioSettings, ownOrigin: string): string {
  return served ? `${ownOrigin}${servedStudioPath}` : `${origin}/`;
}

export function studioLinkOf(studio: StudioSettings, { ownOrigin, openedFrom, installId }: StudioOpening): string {
  const query = new URLSearchParams([
    ['server', ownOrigin],
    ['src', openedFrom],
    ...(installId === undefined ? [] : [['install', installId]]),
  ]);
  return `${studioBaseOf(studio, ownOrigin)}?${query.toString()}`;
}
