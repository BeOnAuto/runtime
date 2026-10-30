import type { CallResult, RejectedCall } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { errorType } from '../dsl/raised-error.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { testFunctions, testSettings } from '../testing/driver-inputs.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const calling = workflow("do:\n  - ask: { call: notify, with: { to: '${ $data.name }' } }");

function wordedBy(name: string, given: Json, { reason, kind, detail }: RejectedCall): string {
  return `turned ${name} for ${JSON.stringify(given)} down as ${reason} of the kind ${String(kind)}, saying ${detail}`;
}

function endedWith(result: CallResult) {
  const driver = memoryDriver({
    sandbox: testSandbox,
    machine: { ...testSettings, functions: { ...testFunctions, refusal: wordedBy } },
    respond: () => ({ after: 10, result }),
  });
  driver.start({ runId: drivenRunId, document: calling, input: { name: 'ada' } });
  return driver.runUntilEnded(drivenRunId).outcome;
}

describe('a call whose functions word its refusals', () => {
  it('is titled in the words the functions give the rejection, read from the call, its arguments and the rejection', () => {
    expect(endedWith({ status: 'rejected', reason: 'invalid_input', kind: 'input_schema', detail: 'No' })).toEqual({
      kind: 'raised',
      error: {
        type: errorType('validation'),
        status: 400,
        instance: '/do/0/ask',
        title:
          'The function notify turned notify for {"to":"ada"} down as invalid_input of the kind input_schema, saying No',
        detail: 'No',
        kind: 'input_schema',
      },
    });
  });

  it('keeps its own words for a call that failed', () => {
    expect(endedWith({ status: 'failed', detail: 'It broke' })).toMatchObject({
      kind: 'raised',
      error: { title: 'The function notify failed', detail: 'It broke' },
    });
  });
});
