import type { ConnectionServices } from '../operations/connection-services.ts';
import { bindsPerson } from '../policy/policy-rules.ts';
import { defineFinishConsent } from './consent-finish.ts';
import { defineStartConsent } from './consent-start.ts';
import { defineGiveClient } from './give-client.ts';
import { defineGiveCredential } from './give-credential.ts';
import { defineApprove, defineReadLink } from './link-operations.ts';
import { defineChooseWay } from './way-choices.ts';

export function pageOperationsOf(connectionServices: ConnectionServices) {
  const services = { ...connectionServices, bindsPerson: bindsPerson(connectionServices.access) };
  const approving = defineApprove(services);
  return {
    approving,
    operations: [
      defineReadLink(services),
      approving,
      defineChooseWay(services),
      defineGiveCredential(services),
      defineGiveClient(services),
      defineStartConsent(services),
      defineFinishConsent(services),
    ],
  };
}
