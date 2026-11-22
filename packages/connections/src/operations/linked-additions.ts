import { OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectOf, studioBaseFor } from '../links/connect-page.ts';
import { connectionShown } from '../registry/connection.ts';
import type { KeptConnection, OpenLink } from '../registry/registry.ts';
import { admittedAdditionOf } from './admitted-additions.ts';
import { rendersFieldOf, type AdditionGiven } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { additionLinkIssuedFor } from './more-asked.ts';

export const admittedWithItsLink = Effect.fnUntraced(function* (
  given: AdditionGiven,
  more: string | undefined,
  services: ConnectionServices,
) {
  const { org } = yield* OrgContext;
  const described = yield* admittedAdditionOf(given, { ...services, org, studioBase: studioBaseFor(services.pages) });
  const { token, ...link } = yield* additionLinkIssuedFor(described, more, services);
  return { described, token, link };
});

export const answeredWithItsLink = Effect.fnUntraced(function* (
  { connection }: KeptConnection,
  { token, link }: { readonly token: string; readonly link: OpenLink },
  { pages, providers }: Pick<ConnectionServices, 'pages' | 'providers'>,
) {
  const { org } = yield* OrgContext;
  return {
    ...connectionShown(connection, null),
    ...rendersFieldOf(providers, connection.provider),
    connect: connectOf(pages, { org, connection: connection.id, token }, link.expires_at),
  };
});
