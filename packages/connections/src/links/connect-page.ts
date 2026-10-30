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

export function studioBaseFor({ studio, runtime }: ConnectPages): string {
  return studioBaseOf(studio, runtime());
}

function connectPageOf({ studio, runtime }: ConnectPages, { org, connection, token }: PageOfALink): string {
  const server = runtime();
  const page = new URL('connect', studioBaseOf(studio, server));
  if (!studio.served) {
    page.searchParams.set('server', server);
    page.searchParams.set('org', org);
  }
  page.searchParams.set('connection', connection);
  page.searchParams.set('token', token);
  return page.href;
}

export interface Connect {
  readonly url: string;
  readonly expires_at: string;
}

export function connectOf(pages: ConnectPages, page: PageOfALink, expiresAt: string): Connect {
  return { url: connectPageOf(pages, page), expires_at: expiresAt };
}

export function returnAddressOf(pages: ConnectPages): string {
  return new URL('connect-return', studioBaseFor(pages)).href;
}
