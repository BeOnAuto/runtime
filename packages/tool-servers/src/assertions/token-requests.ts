import { Schema } from 'effect';

const PointerSchema = Schema.String.annotate({ description: 'A JSON Pointer into the answer' });

export const TokenRequestSchema = Schema.Struct({
  method: Schema.Literal('POST').annotate({ description: 'The method of the request, POST' }),
  url: Schema.String.annotate({
    description: 'The https URL the request is sent to, which lies under the issuer',
  }),
  issued: Schema.Struct({
    access_token: PointerSchema.annotate({ description: 'A JSON Pointer into the answer, to the access token' }),
    expires_at: Schema.optionalKey(
      PointerSchema.annotate({
        description:
          'A JSON Pointer into the answer, to the time the access token ends, in RFC 3339; an hour from its issue when left out',
      }),
    ),
  }).annotate({ description: 'Where the answer names the access token and the time it ends, each as a JSON Pointer' }),
});

export type TokenRequest = typeof TokenRequestSchema.Type;
