import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand } from '../index.ts';
import { allowedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { ada } from '../testing/report-only-calls.ts';

const joinTheNotes = defineCommand('org', {
  name: 'join_the_notes',
  title: 'Join the notes',
  description: 'Makes the caller one of the people who keep the org’s notes.',
  route: { method: 'POST', path: '/notes/keepers' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ joined: Schema.Boolean }),
  reasons: [],
  enrolment: true,
  handle: () => Effect.succeed({ joined: true }),
});

describe('an operation of the org that makes its caller a member', () => {
  it('says so in the question the dispatcher asks, beside everything else it declares', async () => {
    const recording = recordingDecisionPoint(() => allowedByTheTest);
    const { dispatcher, run } = harness({ reportOnly: recording.decisionPoint });

    await run(dispatcher.dispatchToOrg(joinTheNotes.registration, toOrg('acme')(ada, {})));

    expect(recording.asked().map(({ context }) => context.operation)).toEqual([
      {
        kind: 'command',
        targetsPlaybook: false,
        readsOnly: false,
        reachesOutside: false,
        mayChangeOutside: false,
        irreversible: false,
        permissionsManagement: false,
        enrolment: true,
      },
    ]);
  });
});
