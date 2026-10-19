import { DateTime, Option, Redacted, Schema } from 'effect';

const KeptTokensSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_at: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
});

export type KeptTokens = typeof KeptTokensSchema.Type;

const AnsweredTokensSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
});

export type AnsweredTokens = typeof AnsweredTokensSchema.Type;

const KeptValueSchema = Schema.fromJsonString(KeptTokensSchema);

const decodeValue = Schema.decodeUnknownSync(KeptValueSchema);

const encodeValue = Schema.encodeSync(KeptValueSchema);

export const answeredTokensOf = Schema.decodeUnknownSync(AnsweredTokensSchema);

const millisOfASecond = 1000;

export interface TokenHolding {
  readonly holder: string;
  readonly hold: (source: string, token: string) => void;
}

export function keptTokensOf(value: Redacted.Redacted): KeptTokens {
  return decodeValue(Redacted.value(value));
}

export function keptValueOf(tokens: KeptTokens): Redacted.Redacted {
  return Redacted.make(encodeValue(tokens));
}

function expiryOf(nowMillis: number, expiresIn: number | undefined): string | undefined {
  return expiresIn === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(nowMillis + expiresIn * millisOfASecond), DateTime.formatIso));
}

export function keptOf(answered: AnsweredTokens, scope: string | undefined, nowMillis: number): KeptTokens {
  const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = answered;
  const expiresAt = expiryOf(nowMillis, answered.expires_in);
  return {
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    ...(scope === undefined ? {} : { scope }),
    token_type: tokenType,
  };
}

export function heldAmongSecrets(tokens: KeptTokens, { holder, hold }: TokenHolding): void {
  hold(`${holder} access token`, tokens.access_token);
  if (tokens.refresh_token !== undefined) {
    hold(`${holder} refresh token`, tokens.refresh_token);
  }
}
