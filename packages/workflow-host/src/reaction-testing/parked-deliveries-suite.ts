import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { orgFollowerCursorOf } from '../database/org-follower-tables.ts';
import { DeliveryFailed, type Consumer } from '../follower/consumers.ts';
import { orgRecordsOf } from '../follower/org-records.ts';
import type { PassEnd } from '../follower/record-steps.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { passesOn } from './playbook-passes.ts';
import { alpha, byAdmin, published } from './playbook-writes.ts';

const beta = 'playbook/acme/beta/';

const elsewhere = 'playbook/globex/alpha/';

interface Delivering {
  readonly delivered: string[];
  readonly failuresLeft: { count: number };
}

function deliveringFailingFor(playbookKey: string, failures: number): Consumer & Delivering {
  const delivered: string[] = [];
  const failuresLeft = { count: failures };
  return {
    delivered,
    failuresLeft,
    name: 'noting',
    types: ['com.acme.noted'],
    skippedAfterSweeps: 20,
    batchOf: (followed) =>
      Effect.succeed({
        deliveries: [
          {
            key: followed.record.id,
            workflow: 'note',
            deliver: Effect.suspend(() => {
              if (followed.playbookKey === playbookKey && failuresLeft.count > 0) {
                failuresLeft.count -= 1;
                return Effect.fail(new DeliveryFailed({ detail: 'The test failed this delivery' }));
              }
              delivered.push(`${followed.playbook.playbook} ${followed.record.stream}`);
              return Effect.void;
            }),
            skipped: Function.constant(Effect.void),
          },
        ],
        through: followed.record.id,
        more: false,
      }),
  };
}

function noted(database: HostDatabase, playbookKey: string, id: string): Promise<unknown> {
  return published(database.store, { id, type: 'com.acme.noted' }, byAdmin, playbookKey);
}

async function notedInTurn(database: HostDatabase, notes: readonly (readonly [string, string])[]): Promise<void> {
  await notes.reduce<Promise<unknown>>(
    (before, [playbookKey, id]) => before.then(() => noted(database, playbookKey, id)),
    Promise.resolve(),
  );
}

async function followedFailing(settingsOf: SettingsOf, failures: number) {
  const database = await openedOn(await settingsOf());
  const consumer = deliveringFailingFor(alpha, failures);
  const { orgs, pass, held } = passesOn(database, () => ({
    records: orgRecordsOf(database.store),
    consumers: [],
    registered: [consumer],
    calls: [],
    passedEarly: Function.constant(Effect.void),
  }));
  const { through } = await database.store.readAppended(undefined, 0);
  await Effect.runPromise(orgs.follow('acme', orgFollowerCursorOf('acme', through)));
  const triedOnce = Effect.flatMap(orgs.parkedForDelivery(8), (parked) =>
    Effect.forEach(parked, (playbook) => held(playbook)),
  );
  return {
    database,
    consumer,
    orgs,
    passed: (): Promise<PassEnd> => Effect.runPromise(pass('acme', 'signal')),
    tried: (): Promise<readonly PassEnd[]> => Effect.runPromise(triedOnce),
    parked: () => Effect.runPromise(orgs.heldIn('acme')),
  };
}

export function parkedDeliveriesSuite(settingsOf: SettingsOf): void {
  describe('a delivery that fails and waits to be tried again', () => {
    it("parks its playbook alone: the org's other playbook is delivered to meanwhile, and another org's records are not read", async () => {
      const following = await followedFailing(settingsOf, 2);
      await notedInTurn(following.database, [
        [alpha, 'a1'],
        [beta, 'b1'],
        [elsewhere, 'g1'],
        [alpha, 'a2'],
        [beta, 'b2'],
      ]);

      const end = await following.passed();
      const parked = await following.parked();

      expect([end, [...parked]]).toEqual(['caught_up', [alpha]]);
      expect(following.consumer.delivered).toEqual(['beta events/b1', 'beta events/b2']);
    });

    it("resumes the parked playbook's deliveries in order, each once, when its retry succeeds, and follows it with the org again after", async () => {
      const following = await followedFailing(settingsOf, 2);
      await notedInTurn(following.database, [
        [alpha, 'a1'],
        [beta, 'b1'],
        [alpha, 'a2'],
      ]);
      await following.passed();

      const tries = [await following.tried(), await following.tried(), await following.tried()];
      const parked = await following.parked();
      await notedInTurn(following.database, [
        [alpha, 'a3'],
        [beta, 'b2'],
      ]);
      await following.passed();

      expect([tries, [...parked]]).toEqual([[['waiting'], ['caught_up'], []], []]);
      expect(following.consumer.delivered).toEqual([
        'beta events/b1',
        'alpha events/a1',
        'alpha events/a2',
        'alpha events/a3',
        'beta events/b2',
      ]);
    });
  });
}
