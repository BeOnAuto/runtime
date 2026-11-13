import { sha256Of } from '@on.auto/content';
import { jsonPayloadText } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import { keptCallResultOf } from '../machine/call-answers.ts';
import type { RunInput } from '../machine/run-input.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

export const answeredOutput = jsonPayloadText({ text: 'z'.repeat(40_000) }).text;

export const keptOutput = { sha256: sha256Of(answeredOutput), bytes: answeredOutput.length };

const asking = workflow(`
do:
  - ask: { call: notify, with: { to: ada } }
  - pause: { wait: PT1M }
  - measure: { set: '\${ ({ length: $data.text.length }) }' }
`);

export function waitingForItsAnswer(payloadOffloading: boolean): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never', payloadOffloading });
  const toKeep = { ...keptOutput, text: answeredOutput, mediaType: 'application/json' };
  Effect.runSync(driver.ports.payloads.keep('elsewhere', [toKeep]));
  driver.start({ runId: drivenRunId, document: asking });
  return driver;
}

const theAsk = { runId: drivenRunId, reference: '/do/0/ask', run: 1 };

export function answeredByItsDigest(driver: MemoryDriver): RunInput {
  const at = driver.clock.now();
  return { kind: 'call_answered', runId: drivenRunId, at, key: theAsk, result: keptCallResultOf(keptOutput) };
}
