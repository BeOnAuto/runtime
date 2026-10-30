import { openApiPath } from '@on.auto/api';

import { compositionRoot } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';

export async function servedDocumentText(): Promise<string> {
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
    try {
      return await (await fetch(`http://127.0.0.1:${server.port}${openApiPath}`)).text();
    } finally {
      await server.stop();
    }
  } finally {
    ledger.remove();
  }
}
