import { InvalidInput } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { recordChangeInRegistry, recordedCaller } from '../operations/registry-access.ts';
import type { InstallationChosen, LinkUse } from '../registry/connection-commands.ts';
import { connectionShown } from '../registry/connection.ts';
import type { KeptWithConsent } from '../registry/registry-lookup.ts';
import {
  installationRequested,
  installationReturnedOf,
  isRedeemable,
  redeemedOf,
  type Finishing,
} from './consent-returns.ts';
import { installationsListedFor, installPageOf, type Listing } from './listed-installations.ts';
import { replacedWayOf } from './replaced-ways.ts';

export type InstallingServices = Parameters<typeof redeemedOf>[2] & Listing;

type Installation = NonNullable<KeptWithConsent['connection']['credential']['installation']>;

export interface Recording {
  readonly use: LinkUse;
  readonly stateSha256: string;
}

type SentBack = Readonly<Record<string, string>>;

function parametersOf(finishing: Finishing): SentBack {
  const sentBack: { readonly state: string; readonly parameters?: SentBack } = finishing;
  return sentBack.parameters ?? {};
}

function isRequested({ returned }: Installation, parameters: SentBack): boolean {
  return Object.entries(returned.requested ?? {}).some(([name, values]: readonly [string, readonly string[]]) =>
    values.includes(parameters[name] ?? ''),
  );
}

function chosenOf(finishing: Finishing): string | undefined {
  const chosen: { readonly state: string; readonly installation?: string } = finishing;
  return chosen.installation;
}

function codeExpectedOf(name: string): InvalidInput {
  return new InvalidInput({
    detail: `The service sent the person back with no code, so the connection ${name} was not connected. Connect it again.`,
    issues: [{ pointer: '/code', detail: 'Expected the code the authorization server sent the person back with' }],
  });
}

const connectedWith = Effect.fnUntraced(function* (
  kept: KeptWithConsent,
  installation: InstallationChosen,
  { use, stateSha256 }: Recording,
  services: InstallingServices,
) {
  const { client_id: clientId, client_source: clientSource } = kept.consent;
  yield* services.secrets.forget(kept.consent.verifier_secret_id);
  const { before, after } = yield* recordChangeInRegistry(services, {
    type: 'finish',
    ...use,
    connected_by: yield* recordedCaller,
    state_sha256: stateSha256,
    client_id: clientId,
    client_source: clientSource,
    installation,
  });
  yield* replacedWayOf(before, after, services);
  return connectionShown(after.connection, null);
});

export const installationFinished = Effect.fnUntraced(function* (
  kept: KeptWithConsent,
  finishing: Finishing,
  recording: Recording,
  services: InstallingServices,
) {
  const installation = Option.getOrThrow(Option.fromNullishOr(kept.connection.credential.installation));
  const parameters = parametersOf(finishing);
  if (isRequested(installation, parameters)) {
    return installationRequested;
  }
  const chosen = chosenOf(finishing);
  const returned = parameters[installation.returned.installation] ?? '';
  if (chosen === undefined && returned !== '') {
    return installationReturnedOf(returned);
  }
  if (!isRedeemable(finishing)) {
    return yield* Effect.fail(codeExpectedOf(kept.connection.name));
  }
  const finished = yield* redeemedOf(kept, finishing, services);
  const listed = yield* installationsListedFor(kept.connection.name, finished, { installation, chosen }, services).pipe(
    Effect.ensuring(finished.revoked),
  );
  if (chosen === undefined) {
    const asked = { clientId: kept.consent.client_id, state: finishing.state };
    return { installations: listed, install_page: yield* installPageOf(kept.connection, asked, services) };
  }
  return yield* connectedWith(kept, { chosen, listed }, recording, services);
});
