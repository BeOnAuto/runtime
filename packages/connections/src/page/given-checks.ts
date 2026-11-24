import { Unavailable, type Conflict, type InvalidInput, type OrgContext, type OrgReader } from '@on.auto/operations';
import type { EventDestination } from '@on.auto/providers';
import { Effect, Redacted } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { clientCredentialsChecked, type ClientCredentialChecking } from './client-credential-checks.ts';
import { unavailableWords } from './consent-words.ts';
import { appCredentialPointerOf, type GivenAppCredential } from './given-apps.ts';
import { refused, refusedByTheService } from './given-fields.ts';
import { keyTestedOf, type TestingServices, type ValueChecked } from './tested-keys.ts';

export interface AppCredentialOpening {
  readonly destination: EventDestination;
  readonly value: Redacted.Redacted;
  readonly failureCodes?: GivenAppCredential['failureCodes'];
}

export interface SocketChecks {
  readonly openedOnce: (opening: AppCredentialOpening) => Effect.Effect<ValueChecked>;
}

export type CheckingServices = TestingServices & ClientCredentialChecking & Pick<ConnectionServices, 'sockets'>;

type ClientChecking = Parameters<typeof clientCredentialsChecked>;

interface Checked {
  readonly pointer: string;
  readonly checked: ValueChecked;
}

function keyChecked(
  connection: Parameters<typeof keyTestedOf>[0],
  value: string,
  services: TestingServices,
): Effect.Effect<readonly Checked[], never, OrgContext> {
  return Effect.map(keyTestedOf(connection, value, services), (checks) =>
    checks.map((checked) => ({ pointer: '/value', checked })),
  );
}

function appCredentialsChecked(
  given: readonly GivenAppCredential[],
  { sockets }: Pick<ConnectionServices, 'sockets'>,
): Effect.Effect<readonly Checked[]> {
  return sockets === undefined
    ? Effect.succeed([])
    : Effect.forEach(
        given,
        ({ name, value, ...declared }) =>
          Effect.map(sockets.openedOnce({ ...declared, value: Redacted.make(value) }), (checked) => ({
            pointer: appCredentialPointerOf(name),
            checked,
          })),
        { concurrency: 'unbounded' },
      );
}

function verdictOf(checks: readonly Checked[]): Effect.Effect<void, InvalidInput | Unavailable> {
  const refusals = checks.filter(({ checked }) => checked.kind === 'refused');
  if (refusals.length > 0) {
    return Effect.fail(refused(refusals.map(({ pointer }) => ({ pointer, detail: refusedByTheService }))));
  }
  const [unreached] = checks.flatMap(({ checked }) => (checked.kind === 'unreached' ? [checked.hosts] : []));
  return unreached === undefined
    ? Effect.void
    : Effect.fail(new Unavailable({ detail: unavailableWords.valueUnchecked(unreached) }));
}

export function checkedBeforeKeeping(
  connection: Parameters<typeof keyTestedOf>[0],
  { given, apps }: { readonly given: ClientChecking[1]; readonly apps: readonly GivenAppCredential[] },
  services: CheckingServices,
  checking: ClientChecking[3],
): Effect.Effect<void, InvalidInput | Unavailable | Conflict, OrgContext | OrgReader> {
  return Effect.all([keyChecked(connection, given.value, services), appCredentialsChecked(apps, services)], {
    concurrency: 'unbounded',
  }).pipe(
    Effect.flatMap((checked: readonly (readonly Checked[])[]) => verdictOf(checked.flat())),
    Effect.andThen(clientCredentialsChecked(connection, given, services, checking)),
  );
}
