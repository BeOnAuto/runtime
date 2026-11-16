import { Caller } from '@on.auto/operations';
import type { Provider } from '@on.auto/providers';
import { Effect } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { admittedWithItsLink, answeredWithItsLink } from '../operations/linked-additions.ts';
import { additionOf, recordReplacementInRegistry, recordedCaller } from '../operations/registry-access.ts';
import { removedAround } from '../operations/remove-connection.ts';
import { bindingRefusalOf } from '../registry/registry-lookup.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { givenAgainFrom } from './added-again.ts';

export interface AddedAgain {
  readonly from: Provider;
  readonly takesOver: boolean;
  readonly whilePending: boolean;
}

interface Adding extends AddedAgain {
  readonly found: KeptConnection;
  readonly more: string | undefined;
  readonly bindsPerson: boolean;
}

export const addedAgainFrom = Effect.fnUntraced(function* (
  { from, takesOver, whilePending, found, more, bindsPerson }: Adding,
  services: ConnectionServices,
) {
  const binding = takesOver ? undefined : bindingRefusalOf(found, bindsPerson, (yield* Caller).id);
  if (binding !== undefined) {
    return yield* Effect.fail(binding);
  }
  const admitted = yield* admittedWithItsLink(givenAgainFrom(from, found), more, services);
  const recording = recordReplacementInRegistry(services, {
    type: 'replace',
    connection: found.connection.id,
    bindsPerson,
    takesOver,
    whilePending,
    addition: additionOf(admitted.described, admitted.link, yield* recordedCaller),
  });
  const { added } = yield* removedAround(found, recording, services);
  return yield* answeredWithItsLink(added, admitted, services);
});
