import { OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectOf, studioBaseFor } from '../links/connect-page.ts';
import { connectionShown } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { admittedAdditionOf } from './admitted-additions.ts';
import { rendersFieldOf, type AdditionGiven } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { additionLinkIssuedFor, additionMoreChecked } from './more-asked.ts';

const admitted = Effect.fnUntraced(function* (given: AdditionGiven, services: ConnectionServices) {
  const { org } = yield* OrgContext;
  return yield* admittedAdditionOf(given, { ...services, org, studioBase: studioBaseFor(services.pages) });
});

export const admittedWithItsLink = Effect.fnUntraced(function* (
  given: AdditionGiven,
  more: string | undefined,
  services: ConnectionServices,
) {
  const described = yield* admitted(given, services);
  const { token, ...link } = yield* additionLinkIssuedFor(described, more, services);
  return { described, token, link };
});

export const admittedAsARequest = Effect.fnUntraced(function* (
  given: AdditionGiven,
  more: string | undefined,
  services: ConnectionServices,
) {
  const described = yield* admitted(given, services);
  yield* additionMoreChecked(described, more, services);
  return described;
});

export function addedAnswerOf({ connection }: KeptConnection, { providers }: Pick<ConnectionServices, 'providers'>) {
  return { ...connectionShown(connection, null), ...rendersFieldOf(providers, connection.provider) };
}

export const answeredWithItsLink = Effect.fnUntraced(function* (
  kept: KeptConnection,
  { token }: { readonly token: string },
  { pages, providers }: Pick<ConnectionServices, 'pages' | 'providers'>,
) {
  const { org } = yield* OrgContext;
  return {
    ...addedAnswerOf(kept, { providers }),
    connect: connectOf(pages, { org, connection: kept.connection.id, token }),
  };
});
