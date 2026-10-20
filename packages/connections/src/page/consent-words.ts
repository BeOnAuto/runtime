import { Conflict, Forbidden, InvalidInput, Unavailable } from '@on.auto/operations';
import type { ConsentRefusal, RevocationFailure } from '@on.auto/tool-servers';

import { servingWords } from '../serving/serving-words.ts';

export interface ConsentNamed {
  readonly name: string;
  readonly issuer: string;
}

export type ConsentRefused = Conflict | Forbidden | InvalidInput | Unavailable;

type ConflictingRefusal = Extract<
  ConsentRefusal,
  {
    readonly refused:
      | 'another_issuer'
      | 'another_resource'
      | 'no_metadata'
      | 'no_challenge'
      | 'no_client'
      | 'client_gone'
      | 'studio_elsewhere'
      | 'start_refused'
      | 'no_scope'
      | 'malformed_scope';
  }
>;

type Unnamed = Exclude<ConflictingRefusal['refused'], 'another_issuer' | 'another_resource'>;

const notAsAdded = 'so it cannot be connected as it was added';

const conflictsOf: Readonly<Record<Unnamed, (named: ConsentNamed) => string>> = {
  no_metadata: ({ name, issuer }) =>
    `The authorization server of the connection ${name}, ${issuer}, publishes no metadata, ${notAsAdded}`,
  no_challenge: ({ name }) =>
    `The authorization server of the connection ${name} does not take the authorization code with an S256 challenge, which Auto asks for`,
  no_client: ({ name }) =>
    `The authorization server of the connection ${name} takes none of the clients this runtime has for it, ${notAsAdded}`,
  client_gone: ({ name }) => servingWords.clientGone(name),
  start_refused: ({ name }) =>
    `Auto's consent service did not start the consent of the connection ${name}: Auto has no client at its authorization server, or the service does not send people back to the Studio its link opens, so whoever runs this runtime registers a client`,
  studio_elsewhere: ({ name }) =>
    `The connection ${name} takes consent through Auto's client only where Studio is Auto's or on this computer, so whoever runs this runtime registers a client`,
  malformed_scope: ({ name }) =>
    `The authorization server of the connection ${name} granted a scope written with characters a scope does not hold, ${notAsAdded}`,
  no_scope: ({ name }) =>
    `The authorization server of the connection ${name} granted none of the scopes asked, so the connection is not connected; start again and allow them`,
};

const issuerNamedBy: Readonly<
  Record<'server' | 'authorization_server', (named: ConsentNamed, other: string) => string>
> = {
  server: ({ name, issuer }, other) =>
    `The server of the connection ${name} names ${other} as its authorization server, where its provider names ${issuer}, ${notAsAdded}`,
  authorization_server: ({ name, issuer }, other) =>
    `The authorization server of the connection ${name} names ${other} as its issuer in its own metadata, where its provider names ${issuer}, ${notAsAdded}`,
};

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail: 'The consent cannot be finished as it is given', issues: [{ pointer, detail }] });
}

function detailOf(named: ConsentNamed, refusal: ConflictingRefusal): string {
  if (refusal.refused === 'another_issuer') {
    return issuerNamedBy[refusal.by](named, refusal.named);
  }
  return refusal.refused === 'another_resource'
    ? `The server of the connection ${named.name} names ${refusal.named} as the resource it protects, which is not its own address, ${notAsAdded}`
    : conflictsOf[refusal.refused](named);
}

function conflictOf(named: ConsentNamed, refusal: ConflictingRefusal): Conflict {
  return new Conflict({ detail: detailOf(named, refusal) });
}

export function consentRefusalOf(named: ConsentNamed, refusal: ConsentRefusal): ConsentRefused {
  if (refusal.refused === 'host') {
    return new Forbidden({ detail: refusal.rule });
  }
  if (refusal.refused === 'unanswered') {
    return new Unavailable({
      detail: `The authorization server of the connection ${named.name} did not answer as an authorization server does; try again in a moment`,
    });
  }
  if (refusal.refused === 'iss') {
    return refusedAt('/iss', `Expected the issuer of the authorization server of the connection, ${named.issuer}`);
  }
  return refusal.refused === 'code'
    ? refusedAt('/code', 'Expected a code the authorization server takes; it refused this one')
    : conflictOf(named, refusal);
}

const throughAuto = (name: string) =>
  `Expected handle: the consent of the connection ${name} began through Auto's consent service, which answers a handle, not a code`;

const throughARegisteredClient = (name: string) =>
  `Expected code: the consent of the connection ${name} began with the client whoever runs this runtime registered, which answers a code, not a handle`;

export type Returned = 'code' | 'handle';

export function wrongShapeOf({ name }: ConsentNamed, began: Returned, given: Returned): InvalidInput | undefined {
  if (began === given) {
    return undefined;
  }
  return given === 'code'
    ? refusedAt('/code', throughAuto(name))
    : refusedAt('/handle', throughARegisteredClient(name));
}

export function finishRefusalOf(named: ConsentNamed, refusal: ConsentRefusal, given: Returned): ConsentRefused {
  return given === 'handle' && refusal.refused === 'code'
    ? refusedAt('/handle', "Expected a handle Auto's consent service takes; it refused this one")
    : consentRefusalOf(named, refusal);
}

export function unrevokedWordsOf({ name }: ConsentNamed, failure: RevocationFailure): string {
  if (failure.refused === 'not_revoked') {
    return `The authorization server of the connection ${name} refused to revoke its tokens, answering HTTP ${failure.status}, so they end on their own`;
  }
  if (failure.refused === 'host') {
    return `The tokens of the connection ${name} were not revoked, so they end on their own: ${failure.rule}`;
  }
  return failure.refused === 'unanswered'
    ? `The authorization server of the connection ${name} did not answer the revocation of its tokens, so they end on their own`
    : `The tokens of the connection ${name} could not be revoked with the client and at the authorization server it was made with, so they end on their own`;
}
