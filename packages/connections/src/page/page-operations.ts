import type { ConnectionServices } from '../operations/connection-services.ts';
import { defineFinishConsent } from './consent-finish.ts';
import { defineStartConsent } from './consent-start.ts';
import { defineGiveClient } from './give-client.ts';
import { defineGiveCredential } from './give-credential.ts';
import { defineApprove, defineReadLink } from './link-operations.ts';

export function pageOperationsOf(services: ConnectionServices & { readonly bindsPerson: boolean }) {
  return [
    defineReadLink(services),
    defineApprove(services),
    defineGiveCredential(services),
    defineGiveClient(services),
    defineStartConsent(services),
    defineFinishConsent(services),
  ];
}
