import { Function } from 'effect';

import type { RegisterRoutes } from '../routes.ts';
import { answerOf, cachedAnswerOf } from './cached-answer.ts';

export interface ClientMetadataDocument {
  readonly address: string;
  readonly document: Readonly<Record<string, unknown>>;
}

export function clientMetadataRoutes(metadata: ClientMetadataDocument | undefined): RegisterRoutes {
  if (metadata === undefined) {
    return Function.constVoid;
  }
  const path = new URL(metadata.address).pathname;
  const answer = cachedAnswerOf(JSON.stringify(metadata.document), 'application/json');
  return (routes) => {
    routes.addPublic('GET', path, (c) => answerOf(c, answer));
  };
}
