import { listed } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { expressionIssueOf, type ExpressionPlace } from './runtime-expressions.ts';

const ProofFieldsSchema = Schema.Struct({
  scheme: Schema.Literals(['hmac', 'standard-webhooks', 'bearer', 'jwt']).annotate({
    description:
      "How a delivery proves it is the service's: hmac, a keyed hash of what it sends, in a header; standard-webhooks, signed as the Standard Webhooks specification signs a webhook; bearer, the secret itself, in a header; jwt, a JSON Web Token in a header, signed with the secret",
  }),
  secret: Schema.Literals(['subscription', 'app']).annotate({
    description:
      "Which secret proves it: subscription, the subscription's own, which Auto makes or the service answers when Auto subscribes; app, the app's own, set once on the app at the vendor",
  }),
  hash: Schema.optionalKey(
    Schema.Literals(['sha256', 'sha384', 'sha512']).annotate({ description: 'For hmac, the hash function it keys' }),
  ),
  signed_payload: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For hmac, what is signed: {payload}, the body as sent, joined to {timestamp} and {id} where the service signs them, as in v0:{timestamp}:{payload}',
    }),
  ),
  signature: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For hmac, the header that carries the signature, as $request.header.<name>',
    }),
  ),
  prefix: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        'What the signature or the token starts with before its value, such as sha256= or Bearer and a space',
    }),
  ),
  encoding: Schema.optionalKey(
    Schema.Literals(['hex', 'base64']).annotate({ description: 'For hmac, how the signature is written' }),
  ),
  timestamp: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For hmac, the header or the field of the body that holds when the service sent the delivery',
    }),
  ),
  id: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For hmac, the header or the field of the body that holds the id of the delivery, the same on a retry',
    }),
  ),
  token: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For bearer and jwt, the header that carries it, as $request.header.<name>',
    }),
  ),
  alg: Schema.optionalKey(
    Schema.Literals(['HS256', 'HS384', 'HS512']).annotate({
      description: 'For jwt, the algorithm the token is signed with, as JSON Web Algorithms names it',
    }),
  ),
});

type Proof = typeof ProofFieldsSchema.Type;

type Scheme = Proof['scheme'];

type Field = Exclude<keyof Proof, 'scheme' | 'secret'>;

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const everyField: readonly Field[] = [
  'hash',
  'signed_payload',
  'signature',
  'prefix',
  'encoding',
  'timestamp',
  'id',
  'token',
  'alg',
];

const fieldsOfEachScheme: Readonly<Record<Scheme, TakenFields>> = {
  hmac: { required: ['hash', 'signed_payload', 'signature', 'encoding'], optional: ['prefix', 'timestamp', 'id'] },
  'standard-webhooks': { required: [], optional: [] },
  bearer: { required: ['token'], optional: ['prefix'] },
  jwt: { required: ['token', 'alg'], optional: ['prefix'] },
};

type ProofIssue = Schema.FilterIssue;

function takenInWords(scheme: string, { required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  const only = `with the ${scheme} scheme, verify takes only ${listed(['scheme', 'secret', ...taken])}`;
  return taken.length === 0 ? `${only}, because the specification fixes the rest` : only;
}

const theHeaderThatCarriesIt =
  'write the header that carries it, as $request.header.<name>, and give prefix too when something comes before it in that header';

const theFieldThatHoldsIt = 'the header or the field of the body that holds it';

const whatEachNeeds: Readonly<Record<Field, string>> = {
  hash: 'write sha256, sha384 or sha512, whichever the service signs with',
  signed_payload:
    'write what the service signs. Use {payload} once for the body, and join {timestamp} or {id} to it where the service signs them too, as in v0:{timestamp}:{payload}',
  signature: theHeaderThatCarriesIt,
  prefix: 'what comes before the value in its header, such as sha256=',
  encoding: 'write hex or base64, whichever the signature is written in',
  timestamp: theFieldThatHoldsIt,
  id: theFieldThatHoldsIt,
  token: theHeaderThatCarriesIt,
  alg: 'write HS256, HS384 or HS512, whichever the service signs the token with',
};

function wantedWords(field: Field, scheme: string): string {
  return `Expected ${field}, which the ${scheme} scheme needs: ${whatEachNeeds[field]}`;
}

const proofFields: ReadonlySet<string> = new Set(['scheme', 'secret', ...everyField]);

export function isAFieldOfAProof(key: string): boolean {
  return proofFields.has(key);
}

export function proofFieldsInWords(scheme: Schema.Json | undefined): string | undefined {
  const found = Object.entries(fieldsOfEachScheme).find(([name]: readonly [string, TakenFields]) => name === scheme);
  return found === undefined ? undefined : takenInWords(found[0], found[1]);
}

function presenceIssuesOf(proof: Proof): readonly ProofIssue[] {
  const { scheme } = proof;
  const taken = fieldsOfEachScheme[scheme];
  return everyField.flatMap((field): readonly ProofIssue[] => {
    const given = proof[field] !== undefined;
    if (!given && taken.required.includes(field)) {
      return [{ path: [field], issue: wantedWords(field, scheme) }];
    }
    return given && !taken.required.includes(field) && !taken.optional.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: ${takenInWords(scheme, taken)}` }]
      : [];
  });
}

const fromAHeader: ExpressionPlace = {
  transport: 'request',
  sources: ['header'],
  because: 'since a proof is taken from a header alone, never from an address or the message',
};

const fromAHeaderOrTheBody: ExpressionPlace = { transport: 'request', sources: ['header', 'body'] };

function expressionIssuesOf(proof: Proof): readonly ProofIssue[] {
  const placed: readonly (readonly [Field, ExpressionPlace])[] = [
    ['signature', fromAHeader],
    ['token', fromAHeader],
    ['timestamp', fromAHeaderOrTheBody],
    ['id', fromAHeaderOrTheBody],
  ];
  return placed.flatMap(([field, place]): readonly ProofIssue[] => {
    const expression = proof[field];
    const issue = expression === undefined ? undefined : expressionIssueOf(expression, place);
    return issue === undefined ? [] : [{ path: [field], issue }];
  });
}

const signedNames: ReadonlySet<string> = new Set(['id', 'timestamp', 'payload']);

const placedNames: readonly ('timestamp' | 'id')[] = ['timestamp', 'id'];

const namedInBraces = /\{[^{}]*\}/gu;

function namesSignedIn(signed: string): readonly string[] {
  return (signed.match(namedInBraces) ?? []).map((braced) => braced.slice(1, -1));
}

function signedIssueOf(proof: Proof, signed: string): string | undefined {
  const names = namesSignedIn(signed);
  const unknown = names.find((name) => !signedNames.has(name));
  if (unknown !== undefined) {
    return `Holds {${unknown}}, which a signed payload does not have; it holds {id}, {timestamp} and {payload}`;
  }
  if (names.filter((name) => name === 'payload').length !== 1) {
    return 'Expected {payload} once, since the signature covers the body as the service sent it';
  }
  const unplaced = placedNames.find((name) => names.includes(name) && proof[name] === undefined);
  return unplaced === undefined
    ? undefined
    : `Holds {${unplaced}}, so expected ${unplaced} beside it, the header or the field of the body that holds it`;
}

function signedIssuesOf(proof: Proof): readonly ProofIssue[] {
  const issue = proof.signed_payload === undefined ? undefined : signedIssueOf(proof, proof.signed_payload);
  return issue === undefined ? [] : [{ path: ['signed_payload'], issue }];
}

const inTheBody: ExpressionPlace = { transport: 'request', sources: ['body'] };

function signsItsTime({ signed_payload: signed = '', timestamp }: Proof): boolean {
  return (
    timestamp !== undefined &&
    (namesSignedIn(signed).includes('timestamp') || expressionIssueOf(timestamp, inTheBody) === undefined)
  );
}

const provesATime: Readonly<Record<Scheme, (proof: Proof) => boolean>> = {
  hmac: signsItsTime,
  'standard-webhooks': () => true,
  bearer: () => false,
  jwt: () => false,
};

export function provesTheBodyAndATime(proof: Proof): boolean {
  return provesATime[proof.scheme](proof);
}

function signsThePayload({ signed_payload: signed = '' }: Proof): boolean {
  return namesSignedIn(signed).includes('payload');
}

const coversTheBody: Readonly<Record<Scheme, (proof: Proof) => boolean>> = {
  hmac: signsThePayload,
  'standard-webhooks': () => true,
  bearer: () => false,
  jwt: () => false,
};

export function provesTheBody(proof: Proof): boolean {
  return coversTheBody[proof.scheme](proof);
}

export function provesWhatIsReadAt(proof: Proof, expression: string): boolean {
  return provesTheBody(proof) && expressionIssueOf(expression, inTheBody) === undefined;
}

export const VerifySchema = ProofFieldsSchema.check(
  Schema.makeFilter((proof: Proof) => [
    ...presenceIssuesOf(proof),
    ...expressionIssuesOf(proof),
    ...signedIssuesOf(proof),
  ]),
).annotate({
  description:
    "How Auto proves that a delivery is the service's before it reads anything, a signature, a signed token or a secret in a header, never a secret in an address",
});
