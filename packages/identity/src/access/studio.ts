export const defaultStudioOrigin = 'https://studio.on.auto';

export const servedStudioPath = '/studio/';

export interface StudioSettings {
  readonly origin: string;
  readonly served: boolean;
}

export function studioBaseOf({ origin, served }: StudioSettings, ownOrigin: string): string {
  return served ? `${ownOrigin}${servedStudioPath}` : `${origin}/`;
}
