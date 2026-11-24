import type { ChatReading } from '../operations/connection-chat.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { defineApprove } from './approvals.ts';
import { defineFinishConsent } from './consent-finish.ts';
import { defineStartConsent } from './consent-start.ts';
import { defineGiveClient } from './give-client.ts';
import { defineGiveCredential } from './give-credential.ts';
import { defineReadLink } from './link-operations.ts';
import { defineCreateServiceAccount } from './service-accounts.ts';
import { defineChooseWay } from './way-choices.ts';

export function pageOperationsOf(services: ConnectionServices & ChatReading) {
  const approving = defineApprove(services);
  return {
    approving,
    operations: [
      defineReadLink(services),
      approving,
      defineChooseWay(services),
      defineCreateServiceAccount(services),
      defineGiveCredential(services),
      defineGiveClient(services),
      defineStartConsent(services),
      defineFinishConsent(services),
    ],
  };
}
