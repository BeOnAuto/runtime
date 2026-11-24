import { jwkSetPath } from '@on.auto/identity';
import { Schema } from 'effect';

import type { IssuedSubjectTokens } from '../operations/connection-services.ts';
import type { KeptConnection } from '../registry/registry.ts';

export const SubjectTokenShownSchema = Schema.Struct({
  issuer: Schema.String.annotate({ description: 'The https address Auto signs its tokens as, which the steps name' }),
  subject: Schema.String.annotate({
    description: 'The subject Auto signs the tokens of this organization for, which the steps name',
  }),
  jwks_uri: Schema.String.annotate({
    description: 'Where the issuer publishes its public keys, as a JSON Web Key Set',
  }),
  jwk_file: Schema.Boolean.annotate({
    description:
      'true where the steps offer those keys as a file to upload at the service, since the service may not reach this Auto; false where the service reads them from jwks_uri',
  }),
}).annotate({
  description: 'For a connection that exchanges a token Auto signs, what its steps name beside their words',
});

export function subjectTokenShownOf(
  { connection }: Pick<KeptConnection, 'connection'>,
  issued: IssuedSubjectTokens | undefined,
  org: string,
) {
  if (issued === undefined || connection.credential.kind !== 'token_exchange') {
    return {};
  }
  const { issuer } = issued.tokens;
  return { subject_token: { issuer, subject: org, jwks_uri: `${issuer}${jwkSetPath}`, jwk_file: issued.jwkFile } };
}
