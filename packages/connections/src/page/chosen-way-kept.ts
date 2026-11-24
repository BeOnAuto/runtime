import { Effect } from 'effect';

import { connectionShown } from '../registry/connection.ts';
import { asItConnects } from '../registry/kept-next-ways.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { forgottenVerifierOf, releasedClientsForgottenOf, type ConsentServices } from './consent-asking.ts';

export const chosenWayKept = Effect.fnUntraced(function* (
  before: KeptConnection,
  after: KeptConnection,
  services: ConsentServices,
) {
  yield* releasedClientsForgottenOf(before, after, services);
  const connecting = asItConnects(after);
  yield* connecting.consent === undefined ? forgottenVerifierOf(before, services) : Effect.void;
  return connectionShown(connecting.connection, null);
});
