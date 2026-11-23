import type { NotFound } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import {
  ConnectionSchema,
  connectionShown,
  ListedInstallationSchema,
  type RecordedConnection,
} from '../registry/connection.ts';
import type { KeptWithConsent } from '../registry/registry-lookup.ts';
import { namedOf, verifierOf, type ConsentServices, type FinishedConsent } from './consent-asking.ts';
import {
  askedForASignIn,
  finishRefusalOf,
  verifierUnreadOf,
  type ConsentRefused,
  type Returned,
} from './consent-refusals.ts';
import { refusedAt } from './consent-words.ts';

const GivenField = Schema.String.check(Schema.isMinLength(1));

const returnedFields = {
  id: ConnectionIdField,
  token: TokenField,
  state: GivenField.annotate({ description: 'The state the person was sent back with' }),
};

const ParametersField = Schema.Record(Schema.String, Schema.String).annotate({
  description:
    'The other query parameters the authorization server sent the person back with, by name, such as those that name an installation',
});

const CodeSchema = Schema.Struct({
  ...returnedFields,
  code: GivenField.annotate({ description: 'The code the authorization server sent the person back with' }),
  iss: Schema.optionalKey(
    GivenField.annotate({
      description: 'The issuer the authorization server sent the person back with, where it sent one',
    }),
  ),
  parameters: Schema.optionalKey(ParametersField),
  installation: Schema.optionalKey(
    GivenField.annotate({
      description:
        'For a connection made by installing an application, the ID of the installation the person chose among those an earlier finish listed, or the one an earlier finish answered',
    }),
  ),
}).annotate({
  description: "The finish of a consent begun with a client of this runtime's, which answers a code",
});

export const FinishingSchema = Schema.Union([
  CodeSchema,
  Schema.Struct({
    ...returnedFields,
    handle: GivenField.annotate({
      description:
        "The handle Auto's consent service or the connection's gateway sent the person back with, which its tokens or its key are handed over for",
    }),
  }).annotate({ description: "The finish of a consent begun through Auto's consent service or a gateway" }),
  Schema.Struct({ ...returnedFields, parameters: ParametersField }).annotate({
    description:
      'The finish of a consent the authorization server sent the person back from with no code, as after the person only asked for an installation',
  }),
]);

export type Finishing = typeof FinishingSchema.Type;

export type Redeemable = Extract<Finishing, { readonly code: string } | { readonly handle: string }>;

export function isRedeemable(finishing: Finishing): finishing is Redeemable {
  return 'code' in finishing || 'handle' in finishing;
}

export const notRedeemableOf = refusedAt('/code', 'Expected the code or the handle the person was sent back with');

const InstallationsListedSchema = Schema.Struct({
  installations: Schema.Array(ListedInstallationSchema).annotate({
    description:
      'The installations of the application that the person who signed in can reach, each marked admin where they administer its account. Only one they administer can be chosen. It is empty where they can reach none.',
  }),
  install_page: Schema.String.annotate({
    description:
      "The service's page where the person installs the application on another account. It carries the state of this consent, so the service sends the person back to finish it.",
  }),
}).annotate({
  identifier: 'InstallationsListed',
  description:
    'Nothing is connected yet. The person chooses one of the installations they administer and the consent is started again for it, or installs the application on the page.',
});

const InstallationRequestedSchema = Schema.Struct({
  requested: Schema.Literal(true).annotate({
    description:
      "true: the person asked the account's owners to install the application. Nothing is connected: once it is installed, someone who administers that account connects it.",
  }),
}).annotate({ identifier: 'InstallationRequested', description: 'Nothing is connected yet' });

const InstallationReturnedSchema = Schema.Struct({
  installation: GivenField.annotate({
    description:
      'The ID of the installation the service sent the person back with. Start the consent again, and finish it with this ID as installation.',
  }),
}).annotate({
  identifier: 'InstallationReturned',
  description:
    'Nothing is connected yet. The consent is started again for the installation the service sent the person back with.',
});

export const FinishedSchema = Schema.Union([
  ConnectionSchema,
  InstallationsListedSchema,
  InstallationRequestedSchema,
  InstallationReturnedSchema,
]);

export type Finished = typeof FinishedSchema.Type;

export const installationRequested = { requested: true } as const;

export function installationReturnedOf(installation: string): Finished {
  return { installation };
}

export function connectedAnswerOf(connection: RecordedConnection): Finished {
  return connectionShown(connection, null);
}

export function returnedOf(finishing: Finishing): Returned {
  return 'handle' in finishing ? 'handle' : 'code';
}

function returnedFieldsOf(finishing: Redeemable) {
  return 'handle' in finishing ? { handle: finishing.handle } : { code: finishing.code, iss: finishing.iss };
}

export function redeemedOf(
  kept: KeptWithConsent,
  finishing: Redeemable,
  services: ConsentServices,
): Effect.Effect<FinishedConsent, ConsentRefused | NotFound> {
  const { client_id: clientId, client_source: clientSource } = kept.consent;
  const named = namedOf(kept.connection);
  return Effect.gen(function* () {
    const verifier = yield* verifierOf(kept, services, (detail) => verifierUnreadOf(named, detail));
    const asked = yield* askedForASignIn(kept, services, kept.consent.scope);
    const client = { client_id: clientId, client_source: clientSource };
    return yield* services.consent
      .finish({ ...asked, client, ...returnedFieldsOf(finishing), verifier })
      .pipe(Effect.mapError((refusal) => finishRefusalOf(named, refusal, returnedOf(finishing))));
  });
}
