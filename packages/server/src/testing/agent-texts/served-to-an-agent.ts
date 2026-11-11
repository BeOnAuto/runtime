import { debugPath } from '@on.auto/api';
import { servedSurfaceAt, type ServedSurface } from '@on.auto/api/testing';
import { localDeveloper } from '@on.auto/identity/testing';

import { compositionRoot } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';

export interface ServedToAnAgent {
  readonly surface: ServedSurface;
  readonly page: string;
}

const firstCallsOnANewOrg = [{ tool: 'list_playbooks', arguments: {} }];

export async function servedByAThrowawayServer(): Promise<ServedToAnAgent> {
  const ledger = temporaryLedger();
  try {
    const server = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'error',
        LEDGER_FILE: ledger.fileName,
        ...noConsentThroughAuto,
      },
      compositionRoot,
    );
    const origin = `http://127.0.0.1:${server.port}`;
    try {
      const surface = await servedSurfaceAt({
        origin,
        headers: {},
        org: localDeveloper.org,
        playbook: 'alpha',
        actingAs: { caller: localDeveloper, org: localDeveloper.org },
        firstCalls: firstCallsOnANewOrg,
      });
      return { surface, page: await (await fetch(`${origin}${debugPath}`)).text() };
    } finally {
      await server.stop();
    }
  } finally {
    ledger.remove();
  }
}
