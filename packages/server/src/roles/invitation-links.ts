import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/content';
import { invitationPath } from '@on.auto/openid-connect';

const secretBytes = 32;

interface InvitationLink {
  readonly invitation: string;
  readonly link: string;
}

export function invitationOf(secret: string): string {
  return sha256Of(secret);
}

export function invitationLinkAt(publicUrl: string): InvitationLink {
  const secret = randomBytes(secretBytes).toString('base64url');
  return { invitation: invitationOf(secret), link: `${publicUrl}${invitationPath}/${secret}` };
}
