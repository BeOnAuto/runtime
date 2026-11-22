import { debugPath } from '@on.auto/api';
import { servedSurfaceAt, type ServedSurface } from '@on.auto/api/testing';
import { localDeveloper } from '@on.auto/identity/testing';

import { startServerInProcess } from '../../lifecycle/lifecycle.ts';
import { answeredAt, asSentTo, inProcessOrigin } from '../servers/in-process-origins.ts';
import { testComposition } from '../servers/test-compositions.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';

export interface ServedToAnAgent {
  readonly surface: ServedSurface;
  readonly page: string;
}

const firstCallsOnANewOrg = [{ tool: 'list_playbooks', arguments: {} }];

export async function servedByAThrowawayServer(): Promise<ServedToAnAgent> {
  const origin = inProcessOrigin();
  const server = await startServerInProcess(
    { HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'error', LEDGER_FILE: ':memory:', ...noConsentThroughAuto },
    testComposition(),
    origin,
  );
  const leave = answeredAt(origin, asSentTo(server.fetch));
  try {
    const surface = await servedSurfaceAt({
      origin,
      headers: {},
      org: localDeveloper.org,
      playbook: 'alpha',
      actingAs: { caller: localDeveloper, org: localDeveloper.org },
      firstCalls: firstCallsOnANewOrg,
      kept: { goals: true },
    });
    return { surface, page: await (await fetch(`${origin}${debugPath}`)).text() };
  } finally {
    leave();
    await server.stop();
  }
}
