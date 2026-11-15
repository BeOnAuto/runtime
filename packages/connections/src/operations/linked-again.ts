import { OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectOf } from '../links/connect-page.ts';
import { bindsPerson } from '../policy/policy-rules.ts';
import type { ConnectionServices } from './connection-services.ts';
import { linkIssuedFor } from './more-asked.ts';
import { recordInRegistry, recordedCaller } from './registry-access.ts';
import { shownConnection } from './shown-connections.ts';

export const linkedAgain = Effect.fnUntraced(function* (
  id: string,
  more: string | undefined,
  services: ConnectionServices,
) {
  const { secrets, pages, access, variables } = services;
  const { org } = yield* OrgContext;
  const { token, ...link } = yield* linkIssuedFor(id, more, services);
  const kept = yield* recordInRegistry({
    type: 'reconnect',
    connection: id,
    bindsPerson: bindsPerson(access),
    link,
    connected_by: yield* recordedCaller,
    variablesSet: new Set(variables.keys()),
  }).pipe(Effect.catchTag('invalid_input', Effect.die));
  const shown = yield* shownConnection(secrets, kept);
  return kept.link?.token_sha256 === link.token_sha256
    ? { ...shown, connect: connectOf(pages, { org, connection: id, token }, link.expires_at) }
    : shown;
});
