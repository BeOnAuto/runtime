import { Schema } from 'effect';

import { mostReferenceBytes, refusingForbiddenCharacters, refusingLongReferences } from '../ledger/context.ts';

const ClientNaming = Schema.NonEmptyString.check(
  refusingLongReferences,
  refusingForbiddenCharacters,
  Schema.isMaxLength(mostReferenceBytes),
);

export const CallingClientSchema = Schema.Struct({
  id: ClientNaming.annotate({ description: 'The client ID of the client the token was issued to' }),
  name: Schema.NullOr(ClientNaming).annotate({
    description: 'The name the token gives the client, or null where it gives none',
  }),
  domain: Schema.NullOr(ClientNaming).annotate({
    description:
      'The host of the client ID metadata document of a client whose client ID is the https address of that document, or null',
  }),
});

export type CallingClient = typeof CallingClientSchema.Type;
