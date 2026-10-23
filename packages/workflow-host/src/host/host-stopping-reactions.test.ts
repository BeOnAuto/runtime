import { streamAppends, type StreamSignal } from '@on.auto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';
import { heldStart, type HeldStart } from '../reaction-testing/held-start.ts';
import { eventTrigger, published, definitionRecorded } from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const anHourMs = 3_600_000;

const sweepEveryMs = 20;

function toldWhenTheFollowerStops(stopped: () => void): StreamSignal {
  return {
    raise: streamAppends.raise,
    listen: (listener) => {
      const stopListening = streamAppends.listen(listener);
      return () => {
        stopListening();
        stopped();
      };
    },
  };
}

async function startingAReaction(
  held: HeldStart,
  settings: DatabaseSettings,
  appended: StreamSignal = streamAppends,
): Promise<ReactingHost> {
  const reacting = await reactingHost({ settings, start: held.start, sweepEveryMs, appended });
  const trigger = eventTrigger({ type: 'com.acme.closed' });
  await definitionRecorded(reacting.database.store, { name: 'close', version: 1, triggers: [trigger] });
  await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
  await held.begun;
  return reacting;
}

describe('a reaction starting a run while its host stops serving', () => {
  it('starts the run before the host refuses starts, when the host is told to stop', async () => {
    const held = heldStart();
    const reacting = await startingAReaction(held, { store: 'sqlite', file: aSQLiteFile() });

    const stopping = reacting.host.stop();
    held.release(reacting.host);
    await stopping;

    expect(held.exits()).toEqual([Exit.succeed('started')]);
  });

  it('starts the run before the host stands by, when another host takes the workflows over', async () => {
    const held = heldStart();
    const settings: DatabaseSettings = { store: 'sqlite', file: aSQLiteFile() };
    const standingBy = Promise.withResolvers<void>();
    const reacting = await startingAReaction(held, settings, toldWhenTheFollowerStops(standingBy.resolve));

    await hostedOn(settings, { holder: 'ahead', clock: { now: () => Date.now() + anHourMs, sleep: Effect.sleep } });
    await standingBy.promise;
    held.release(reacting.host);
    const notes = await until(() => {
      const noted = reacting.notes();
      expect(noted).not.toHaveLength(0);
      return noted;
    });

    expect(held.exits()).toEqual([Exit.succeed('started')]);
    expect(notes).toMatchObject([{ kind: 'standing_by', holder: 'ahead' }]);
  });
});
