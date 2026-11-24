import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { allowedToChoose, linkedThrough, recordInRegistry, recordedCaller } from '../operations/registry-access.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { checkedBeforeApproval } from './approval-checks.ts';
import type { ExchangeChecking, Reached } from './exchange-checks.ts';
import { LinkWithPlaybooksSchema } from './link-operations.ts';

const ApprovedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  reached: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'For a connection that exchanges a token, the names of what it reaches at the service, as the check its way declares lists them, at most 50. Left out where its way declares no check.',
    }),
  ),
}).annotate({ identifier: 'ApprovedConnection', description: 'The connection approved, and what it reaches' });

function reachedShown({ reached }: Reached) {
  return reached === undefined ? {} : { reached };
}

export function defineApprove(services: ExchangeChecking) {
  return defineHttpOperation('org', 'command', {
    name: 'approve',
    title: 'Approve connection',
    description: [
      'Approves a connection that takes no credential to give, one of the credential none, reference or token_exchange, through its open link, and answers it connected.',
      'On a runtime that signs people in, only an admin of the organization may approve it.',
      'A connection that takes a secret or client credentials is approved by give_credential instead.',
      'For token_exchange, Auto first gets a token from the service, and nothing is saved where the service refuses it, as invalid_input, or does not answer, as unavailable; where the way declares a check, Auto then lists what the connection reaches and answers it in reached, and a connection that acts as a service account Auto created and reaches nothing yet is refused as conflict.',
      'Given playbooks, a list of playbook ids or null for every playbook of the org, it sets which playbooks may use the connection in the same record as the approval; left out, the connection keeps the playbooks it has. A caller that may access only some playbooks of the org is refused as forbidden when it gives playbooks.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/approve' },
    body: { kind: 'json' },
    connectionsManagement: true,
    inputSchema: LinkWithPlaybooksSchema,
    outputSchema: ApprovedSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, token, ...choice }) {
      yield* allowedToChoose(choice.playbooks);
      const { kept, use } = yield* linkedThrough(services, { id, token });
      const checked = yield* checkedBeforeApproval(kept, services);
      const { connection } = yield* recordInRegistry(services, {
        type: 'approve',
        ...use,
        connected_by: yield* recordedCaller,
        ...choice,
      }).pipe(Effect.catchTag('invalid_input', Effect.die));
      return { ...connectionShown(connection, null), ...reachedShown(checked) };
    }),
  });
}
