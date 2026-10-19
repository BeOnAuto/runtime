import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('a run whose input and output hold U+0000', () => {
  it('lists, filters and reads like any other', async () => {
    const { createDefinition, runDefinition, getRunHistory, listRuns } = definitionOperationsFor([echo]);
    const { call } = harness();
    await call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi\\u0000"}' }),
    );
    await call(
      runDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: { text: 'a\u0000b' }, run_id: runId }),
    );

    expect(
      await call(listRuns, toAlpha(acmeAdmin, { status: 'succeeded', name: 'greet', type: 'echo' })),
    ).toMatchObject({ status: 'succeeded', output: { runs: [{ run_id: runId }] } });
    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          { data: { input: { text: 'a\u0000b' } } },
          { data: { output: { greeting: 'Hi\u0000', input: { text: 'a\u0000b' } } } },
        ],
      },
    });
  });
});
