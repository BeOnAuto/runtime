import type { KoaContextWithOIDC } from 'oidc-provider';

import { redirectedTo, shown, signInCookieAttributes } from './answering.ts';
import type { InteractionSignIn, SignInPages } from './interaction-pages.ts';
import { invitationPath } from './paths.ts';

const invitationCookie = '__Host-Http-invitation';

const invitationMs = 3_600_000;

const unreferred = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } as const;

interface InvitationsServed {
  readonly signIn: Pick<InteractionSignIn, 'invitationOpened'>;
  readonly pages: SignInPages;
}

export function invitationSecretIn(path: string): string | undefined {
  return path.startsWith(`${invitationPath}/`) ? path.slice(invitationPath.length + 1) : undefined;
}

export async function invitationOpened(
  ctx: KoaContextWithOIDC,
  { signIn, pages }: InvitationsServed,
  secret: string,
): Promise<void> {
  const opened = await signIn.invitationOpened(secret);
  if ('ended' in opened) {
    await shown(ctx, pages, { invitationEnded: true });
    ctx.set(unreferred);
    return;
  }
  ctx.cookies.set(invitationCookie, secret, { ...signInCookieAttributes, maxAge: invitationMs });
  ctx.set(unreferred);
  redirectedTo(ctx, opened.location);
}

export function invitationCarriedAndCleared(ctx: KoaContextWithOIDC): string | undefined {
  const carried = ctx.cookies.get(invitationCookie);
  ctx.cookies.set(invitationCookie, null, signInCookieAttributes);
  return carried;
}
