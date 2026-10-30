import { makeAppRuntime, type AppRuntime } from '@on.auto/api';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { DispatcherServices } from '@on.auto/operations';

import { applicationLayer } from '../../composition/application-layer.ts';

export function memoryRuntime(): Promise<AppRuntime<DispatcherServices>> {
  return makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
}
