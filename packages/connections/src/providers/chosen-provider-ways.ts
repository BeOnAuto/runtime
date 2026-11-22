import { InvalidInput, type Issue } from '@on.auto/operations';
import { additionOfProvider, isTheWayAsked, type Provider } from '@on.auto/providers';
import { Result } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import type { WayAsked } from '../registry/way-decisions.ts';
import { gatewayUnofferedOf, isOfferedWay, oauthClientForOf, waysInOrderOf, type Listing } from './provider-listing.ts';

export interface ChosenCredential {
  readonly credential: RecordedConnection['credential'];
  readonly says: Readonly<Record<string, string>>;
}

type Chosen = Pick<RecordedConnection, 'name' | 'placeholders'>;

function cannotConnectThisWay({ name }: Chosen, issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: `The connection ${name} cannot connect this way.`, issues });
}

function gatewayIssuesOf(named: Provider, { credential }: ChosenCredential, listing: Listing): readonly Issue[] {
  const unoffered = credential.client_source === 'gateway' ? gatewayUnofferedOf(named, listing) : undefined;
  return unoffered === undefined ? [] : [{ pointer: '/credential', detail: unoffered }];
}

function resolvedWith(
  named: Provider,
  connection: Chosen,
  { credential: asked }: WayAsked,
  listing: Listing,
): Result.Result<ChosenCredential, readonly Issue[]> {
  const credentials = waysInOrderOf(named, listing).filter((way) => isTheWayAsked(way, asked));
  const addition = additionOfProvider(
    { ...named.entry, credentials },
    {
      placeholders: connection.placeholders ?? {},
      kind: asked.kind,
      oauthClientFor: oauthClientForOf(named, listing),
      canBeGiven: (way) => isOfferedWay(named, way, listing),
    },
  );
  return Result.map(addition, ({ credential, permissions, says = {} }) => ({
    credential: { ...credential, ...(permissions === undefined ? {} : { permissions }) },
    says,
  }));
}

export function providerCredentialChosen(
  named: Provider,
  connection: Chosen,
  asked: WayAsked,
  listing: Listing,
): Result.Result<ChosenCredential, InvalidInput> {
  return Result.match(resolvedWith(named, connection, asked, listing), {
    onFailure: (issues) => Result.fail(cannotConnectThisWay(connection, issues)),
    onSuccess: (chosen) => {
      const issues = gatewayIssuesOf(named, chosen, listing);
      return issues.length === 0 ? Result.succeed(chosen) : Result.fail(cannotConnectThisWay(connection, issues));
    },
  });
}
