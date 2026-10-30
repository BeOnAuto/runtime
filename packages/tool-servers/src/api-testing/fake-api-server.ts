import type { LoopbackServer } from '../testing/fetch-handler.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import {
  basePath,
  documentPath,
  fakeApiAnswers,
  type FakeApiOptions,
  type FakeApiServer,
  type FakeIssuing,
  type IssuingAnswers,
} from './fake-api-answers.ts';

type ServedIssuing = FakeIssuing & Pick<LoopbackServer, 'heard' | 'close'>;

async function servedIssuing({ handlerAt, tokenRequests, revokeTokens }: IssuingAnswers): Promise<ServedIssuing> {
  const listening = await serveOnLoopback(handlerAt);
  return { issuer: listening.origin, tokenRequests, revokeTokens, heard: listening.heard, close: listening.close };
}

export async function serveFakeApi(options: FakeApiOptions = {}): Promise<FakeApiServer> {
  const answers = fakeApiAnswers(options);
  const issuing = answers.issuing === undefined ? undefined : await servedIssuing(answers.issuing);
  const listening = await serveOnLoopback(() => answers.handler);
  const hearing = issuing === undefined ? [listening] : [listening, issuing];
  return {
    origin: listening.origin,
    baseUrl: `${listening.origin}${basePath}`,
    documentUrl: `${listening.origin}${documentPath}`,
    issuing,
    seen: answers.seen,
    heard: () => hearing.flatMap((each) => each.heard()),
    documentReads: answers.documentReads,
    answerNextWith: answers.answerNextWith,
    close: async () => {
      await Promise.all([listening.close(), issuing?.close()]);
    },
  };
}
