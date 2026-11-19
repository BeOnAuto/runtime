import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbooksOfRecords, wokenOrgOf } from './org-records.ts';

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/';

describe("the org a stream's append wakes", () => {
  it("is the org its playbook's or its definition's key names, and none for a run's log, the org's own streams or a name with no key", () => {
    const woken = [
      'playbook/acme/alpha/events/e1',
      `${triage}runs/r1`,
      'playbook/acme/alpha/run-logs/r1',
      `${triage}run-logs/r1`,
      'org/acme/connections/c1',
      'org/acme/playbooks',
    ].map((stream) => wokenOrgOf(stream));

    expect(woken).toEqual(['acme', 'acme', undefined, undefined, undefined, undefined]);
  });
});

const namesOfBeta = new Map([
  [
    triage,
    {
      definitionKey: triage,
      playbookKey: 'playbook/acme/beta/',
      definitionType: 'workflow',
      name: 'triage',
      status: 'active',
      hasTriggers: false,
    },
  ],
]);

describe('the playbook of a record the follower of an org reads', () => {
  it("is its playbook's key, or the playbook its definition holds a name in, read once a definition for the pass, and none for a definition that holds no name or a stream of the org's own", async () => {
    const asked: string[] = [];
    const playbookOf = playbooksOfRecords({
      nameHeldBy: (definitionKey) => {
        asked.push(definitionKey);
        return Promise.resolve(namesOfBeta.get(definitionKey));
      },
    });

    const playbooks = await Effect.runPromise(
      Effect.forEach(
        [
          'playbook/acme/alpha/events/e1',
          `${triage}runs/r1`,
          `${triage}run-logs/r1`,
          `${summary}runs/r2`,
          `${summary}runs/r3`,
          'org/acme/connections/c1',
          'org/acme/playbooks',
        ],
        (stream) => playbookOf({ stream, type: 'run_started' }),
      ),
    );

    expect(playbooks.map((place) => place?.playbookKey)).toEqual([
      'playbook/acme/alpha/',
      'playbook/acme/beta/',
      'playbook/acme/beta/',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(asked).toEqual([triage, summary]);
  });
});

describe('the name a record of a definition is followed under', () => {
  it('is the name the definition holds now, read again at each fact of the definition', async () => {
    const asked: string[] = [];
    const playbookOf = playbooksOfRecords({
      nameHeldBy: (definitionKey) => {
        asked.push(definitionKey);
        return Promise.resolve(namesOfBeta.get(definitionKey));
      },
    });

    const places = await Effect.runPromise(
      Effect.forEach(
        [
          { stream: `${triage}runs/r1`, type: 'run_started' },
          { stream: `${triage}definitions/workflow`, type: 'definition_renamed' },
          { stream: `${triage}runs/r2`, type: 'run_started' },
        ],
        (record: { readonly stream: string; readonly type: string }) => playbookOf(record),
      ),
    );

    expect(places.map((place) => place?.held?.name)).toEqual(['triage', 'triage', 'triage']);
    expect(asked).toEqual([triage, triage]);
  });
});
