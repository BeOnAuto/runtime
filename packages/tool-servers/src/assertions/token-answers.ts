import { boundedAnswerOf } from '@on.auto/outbound';
import { Option, Schema } from 'effect';

import { ignored } from '../clients/ignored.ts';
import { passingErrorCodes } from '../consent/consent-failures.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { mostAnswerBytes, type AssertedTokens } from './requested-tokens.ts';
import { TokenRequestFailed } from './token-request-failed.ts';

const statusesOfARefusal: ReadonlySet<number> = new Set([400, 401]);

const rateLimited = 429;

const firstServerError = 500;

const refusalOfText = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String.check(Schema.isPattern(/^[\w.-]{1,64}$/u)) })),
);

const tokensOfText = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      access_token: Schema.String.check(Schema.isMinLength(1)),
      expires_in: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);

function tokensIn(text: string, status: number, host: string): AssertedTokens {
  const { access_token: accessToken, expires_in: expiresIn } = Option.getOrThrowWith(
    tokensOfText(text),
    () => new TokenRequestFailed(status, host, false),
  );
  return typeof expiresIn === 'number' && expiresIn > 0
    ? { access_token: accessToken, expires_in: expiresIn }
    : { access_token: accessToken };
}

function failureOf(status: number, host: string, text: string): Error {
  const refusal = statusesOfARefusal.has(status) ? refusalOfText(text) : Option.none();
  return Option.match(refusal, {
    onNone: () => new TokenRequestFailed(status, host, status === rateLimited || status >= firstServerError),
    onSome: ({ error }) =>
      passingErrorCodes.includes(error) ? new TokenRequestFailed(status, host, true) : new AssertionRefused(error),
  });
}

export async function tokensAnswered(response: Readonly<Response>, host: string): Promise<AssertedTokens> {
  const text = await boundedAnswerOf(response, mostAnswerBytes, ignored).text();
  if (response.ok) {
    return tokensIn(text, response.status, host);
  }
  throw failureOf(response.status, host, text);
}
