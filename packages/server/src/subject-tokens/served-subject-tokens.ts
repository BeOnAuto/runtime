import type { AppRuntime, RegisterRoutes } from '@on.auto/api';
import {
  issuerMetadataOf,
  issuerMetadataPath,
  jwkSetPath,
  subjectTokensSignedWith,
  type IssuerMetadata,
  type JwkSet,
  type SubjectTokens,
} from '@on.auto/identity';
import type { DispatcherServices } from '@on.auto/operations';
import { Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import {
  subjectTokenKeyKeptBy,
  type SubjectTokenKeyFailure,
  type SubjectTokenKeyServices,
} from './subject-token-key.ts';

export const issuerPath = '/oidc';

const signingAlgorithm = 'RS256';

const documentHeaders: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
};

interface IssuerAnswer {
  readonly path: string;
  readonly answer: () => Response;
}

interface SubjectTokensIssued {
  readonly issuing: SubjectTokens | undefined;
  readonly answers: readonly IssuerAnswer[];
}

interface ServedSubjectTokens {
  readonly issuing: SubjectTokens | undefined;
  readonly routes: RegisterRoutes;
}

interface IssuerDocuments {
  readonly metadata: IssuerMetadata;
  readonly keySet: JwkSet;
}

export function subjectTokenIssuerOf(publicUrl: string | undefined): string | undefined {
  return publicUrl?.startsWith('https://') === true ? `${publicUrl}${issuerPath}` : undefined;
}

function answerOf(path: string, document: unknown): IssuerAnswer {
  const body = JSON.stringify(document);
  return { path, answer: () => new Response(body, { headers: documentHeaders }) };
}

function issuerAnswersOf(issuer: string, { metadata, keySet }: IssuerDocuments): readonly IssuerAnswer[] {
  const { pathname } = new URL(issuer);
  return [answerOf(`${pathname}${issuerMetadataPath}`, metadata), answerOf(`${pathname}${jwkSetPath}`, keySet)];
}

function routesAnswering(answers: readonly IssuerAnswer[]): RegisterRoutes {
  return (routes) => {
    for (const { path, answer } of answers) {
      routes.addPublic('GET', path, answer);
    }
  };
}

const noIssuer: SubjectTokensIssued = { issuing: undefined, answers: [] };

export function subjectTokensServedBy(
  publicUrl: string | undefined,
  services: SubjectTokenKeyServices,
): Effect.Effect<SubjectTokensIssued, SubjectTokenKeyFailure> {
  const issuer = subjectTokenIssuerOf(publicUrl);
  if (issuer === undefined) {
    return Effect.succeed(noIssuer);
  }
  return Effect.gen(function* () {
    const jwk = yield* subjectTokenKeyKeptBy(services);
    const issuing = subjectTokensSignedWith({ issuer, key: { alg: signingAlgorithm, jwk } });
    const keySet = yield* Effect.promise(issuing.keySet);
    const metadata = issuerMetadataOf(issuer, signingAlgorithm);
    return { issuing, answers: issuerAnswersOf(issuer, { metadata, keySet }) };
  });
}

export async function subjectTokensOpenedIn(
  runtime: AppRuntime<DispatcherServices>,
  publicUrl: string | undefined,
  secrets: SubjectTokenKeyServices['secrets'],
): Promise<ServedSubjectTokens> {
  const services = { registry: runtimeLedger(runtime), secrets };
  const { issuing, answers } = await Effect.runPromiseWith(runtime.context)(subjectTokensServedBy(publicUrl, services));
  return { issuing, routes: routesAnswering(answers) };
}
