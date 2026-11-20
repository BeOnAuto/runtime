import type { KoaContextWithOIDC } from 'oidc-provider';

import type { PageShown, SignInPages } from './interaction-pages.ts';

const seeOther = 303;

export const signInCookieAttributes = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  overwrite: true,
} as const;

export async function shown(ctx: KoaContextWithOIDC, pages: SignInPages, page: PageShown): Promise<void> {
  const { status, html, headers } = await pages(page);
  ctx.status = status;
  ctx.set(headers);
  ctx.type = 'html';
  ctx.body = html;
}

export function redirectedTo(ctx: KoaContextWithOIDC, location: string): void {
  ctx.set('cache-control', 'no-store');
  ctx.status = seeOther;
  ctx.redirect(location);
}
