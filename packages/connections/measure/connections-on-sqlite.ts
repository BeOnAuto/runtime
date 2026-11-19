import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger, makeDispatcher } from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { providerListOf } from '@on.auto/providers/testing';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { makeConnectionOperations } from '../src/operations/connection-operations.ts';
import { connectionPolicyOf } from '../src/policy/connection-policy.ts';
import { fakeReads, harnessConsentOf, keptSecrets } from '../src/testing/harness-services.ts';
import { ada, harnessPages, operationNamed } from '../src/testing/harness.ts';

const refusingEveryRequest: typeof globalThis.fetch = () => Promise.reject(new TypeError('No request is sent'));

const dispatcher = makeDispatcher([]);

export async function connectionsOnSQLite(fileName: string) {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(ledgerLayer({ fileName }), memoryPlaybookRegistry([]), recordingReporter().layer),
  );
  const registry = await runtime.runPromise(Effect.service(Ledger));
  const secrets = keptSecrets({});
  const providers = providerListOf();
  const operations = makeConnectionOperations({
    secrets,
    policy: connectionPolicyOf({}),
    fileEntries: [],
    modelProviders: [],
    providers,
    providerValues: new Map(),
    variables: new Map(),
    pages: harnessPages,
    access: 'people',
    consent: harnessConsentOf(registry, secrets, { fetch: refusingEveryRequest }),
    resolve: () => Promise.resolve(['93.184.216.34']),
    fetch: refusingEveryRequest,
    readOnceThrough: fakeReads().readOnceThrough,
  });
  return {
    registry,
    providers,
    runtime,
    dispatched: (name: string, input: object) =>
      dispatcher.dispatchToOrg(operationNamed(operations, name).registration, {
        caller: ada,
        org: 'acme',
        input,
        encoding: 'json',
      }),
  };
}
