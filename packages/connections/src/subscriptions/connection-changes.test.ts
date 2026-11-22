import type { Decided, PlaybookAddress } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { addedFact } from '../testing/loop-registries.ts';
import { connectionChangesRelayed } from './connection-changes.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const everyOne: readonly PlaybookAddress[] = [alpha, beta];

function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect);
}

const ada = { id: 'person:ada', name: 'Ada Lovelace' };

function connectionsOver() {
  const ledger = memoryLedger().service;
  const recorded = {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (facts: readonly Decided<RecordedConnectionEvent>[]) => Result.succeed(facts),
    context: () => ({ at: '2026-11-18T09:00:00.000Z', by: ada.id }),
  };
  const kept: { place?: string } = {};
  const asked: PlaybookAddress[] = [];
  const unanswering = new Set<string>();
  const relayed = () =>
    run(
      connectionChangesRelayed({
        ledger,
        org: 'acme',
        place: {
          kept: Effect.sync(() => kept.place),
          moved: (place) =>
            Effect.sync(() => {
              kept.place = place;
            }),
        },
        playbooks: Effect.succeed(everyOne),
        asked: (playbook) =>
          unanswering.has(playbook.playbook)
            ? Effect.fail('unanswered')
            : Effect.sync(() => {
                asked.push(playbook);
              }),
      }),
    );
  const changed = (...facts: readonly Decided<RecordedConnectionEvent>[]) =>
    run(Effect.orDie(ledger.execute(connectionsStreamOfOrg('acme'), recorded, facts)));
  return { kept, asked, unanswering, relayed, changed };
}

const connected = (connection: string): Decided<RecordedConnectionEvent> => ({
  type: 'connection_connected',
  data: { connection, secret_id: `token-${connection}`, connected_by: ada },
});

const broken = (connection: string): Decided<RecordedConnectionEvent> => ({
  type: 'connection_broken',
  data: { connection, kind: 'credential_refused', reason: 'The service refused the token' },
});

describe('the relay of the org’s connections to the playbooks that listen through one', () => {
  it('asks every playbook once where it keeps no place, then starts at the newest fact of the connections', async () => {
    const relay = connectionsOver();
    await relay.changed(addedFact('connection-1', 'tracker', null), connected('connection-1'));

    expect(await relay.relayed()).toEqual({ asked: 2, unanswered: 0 });
    expect(await relay.relayed()).toEqual({ asked: 0, unanswered: 0 });
    expect(relay.asked).toEqual([alpha, beta]);
    expect(relay.kept.place).toEqual(expect.any(String));
  });

  it('asks after a fact after which what the loop reads of a connection may change, and passes the others', async () => {
    const relay = connectionsOver();
    await relay.relayed();
    const askedAfter = async (fact: Decided<RecordedConnectionEvent>) => {
      await relay.changed(fact);
      return (await relay.relayed()).asked > 0;
    };

    expect([
      await askedAfter(addedFact('connection-2', 'chat', null)),
      await askedAfter(broken('connection-2')),
      await askedAfter(connected('connection-2')),
      await askedAfter({ type: 'connection_playbooks_set', data: { connection: 'connection-2', playbooks: ['beta'] } }),
      await askedAfter({ type: 'connection_removed', data: { connection: 'connection-2' } }),
      await askedAfter({
        type: 'connection_identified',
        data: { connection: 'connection-1', connected_at: '2026-11-17T08:00:00.000Z', user: { id: 'h-7' } },
      }),
    ]).toEqual([false, false, true, true, true, false]);
  });
});

describe('the place of the relay of the org’s connections', () => {
  it('stays while a playbook has not answered, every one asked again at the next pass', async () => {
    const relay = connectionsOver();
    await relay.relayed();
    const before = relay.kept.place;
    await relay.changed(connected('connection-1'));
    relay.unanswering.add('beta');

    expect(await relay.relayed()).toEqual({ asked: 2, unanswered: 1 });
    expect(relay.kept.place).toBe(before);
    relay.unanswering.clear();
    expect(await relay.relayed()).toEqual({ asked: 2, unanswered: 0 });
    expect(relay.kept.place).not.toBe(before);
    expect(relay.asked).toEqual([alpha, beta, alpha, alpha, beta]);
  });

  it('is read past more facts than one read takes, and the relay asks once where the ledger no longer holds it', async () => {
    const relay = connectionsOver();
    await relay.relayed();
    const brokenMany = Array.from({ length: 250 }, (_, index) => broken(`connection-${String(index)}`));
    await relay.changed(...brokenMany);
    const passed = await relay.relayed();
    await relay.changed(...brokenMany, connected('connection-1'));
    const owed = await relay.relayed();
    relay.kept.place = 'a place no ledger holds';

    expect([passed, owed, await relay.relayed()]).toEqual([
      { asked: 0, unanswered: 0 },
      { asked: 2, unanswered: 0 },
      { asked: 2, unanswered: 0 },
    ]);
  });
});
