import { studioBaseOf, type StudioSettings } from '@on.auto/identity';

export interface ConnectPages {
  readonly studio: StudioSettings;
  readonly runtime: () => string;
}

export interface PageOfALink {
  readonly org: string;
  readonly connection: string;
  readonly token: string;
}

export function connectPageOf({ studio, runtime }: ConnectPages, { org, connection, token }: PageOfALink): string {
  const server = runtime();
  const page = new URL('connect', studioBaseOf(studio, server));
  page.searchParams.set('server', server);
  page.searchParams.set('org', org);
  page.searchParams.set('connection', connection);
  page.searchParams.set('token', token);
  return page.href;
}
