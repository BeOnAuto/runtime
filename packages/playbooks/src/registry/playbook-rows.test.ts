import {
  Ledger,
  PlaybookRegistry,
  addressedStreamOf,
  recordingOf,
  type Context,
  type Decider,
  type ProjectedMessage,
} from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer, Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerPlaybookRegistry } from './ledger-playbook-registry.ts';
import type { PlaybookEvent, RecordedPlaybookEvent } from './playbook-events.ts';
import { playbookRows, playbookRowsName, registryOfRows } from './playbook-rows.ts';
import { playbooksStreamOfOrg } from './playbooks-stream.ts';
import { registryDecider } from './registry-decider.ts';
import type { Registry } from './registry.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const ada = { id: 'person:user_2ada', name: 'Ada Lovelace' };

const editor = 'acme-editor';

function created(playbook: string, name: string): PlaybookEvent {
  return { type: 'playbook_created', data: { playbook, name, description: `What ${name} is for`, created_by: ada } };
}

const gammaRenamed: PlaybookEvent = { type: 'playbook_updated', data: { playbook: 'gamma', name: 'Gamma two' } };

const history: readonly (readonly [PlaybookEvent, Context])[] = [
  [created('gamma', 'Gamma'), { by: ada.id, at: '2026-10-01T09:00:00.000Z' }],
  [created('alpha', 'Alpha'), { by: ada.id, at: '2026-10-01T09:05:00.000Z' }],
  [gammaRenamed, { by: editor, at: '2026-10-02T10:00:00.000Z' }],
  [
    { type: 'playbook_retired', data: { playbook: 'alpha' } },
    { by: editor, at: '2026-10-03T10:00:00.000Z' },
  ],
  [created('beta', 'Beta'), { by: ada.id, at: '2026-10-04T09:00:00.000Z' }],
  [
    { type: 'playbook_retired', data: { playbook: 'beta' } },
    { by: editor, at: '2026-10-05T10:00:00.000Z' },
  ],
  [
    { type: 'playbook_restored', data: { playbook: 'beta' } },
    { by: editor, at: '2026-10-06T10:00:00.000Z' },
  ],
];

type Recording = readonly [PlaybookEvent, Context];

const recordingDecider: Decider<Registry, Recording, RecordedPlaybookEvent> = {
  ...registryDecider,
  decide: ([event]) => Result.succeed([event]),
  context: ([, context]) => context,
};

async function playbooksKept() {
  const ledger = memoryLedger(undefined, [playbookRows]);
  const services = Layer.mergeAll(ledger.layer, Layer.provide(ledgerPlaybookRegistry, ledger.layer));
  const run = <A>(work: Effect.Effect<A, unknown, Ledger | PlaybookRegistry>) =>
    Effect.runPromise(Effect.provide(work, services));
  await run(
    Effect.flatMap(Ledger, (service) =>
      Effect.forEach(history, (each) => service.execute(playbooksStreamOfOrg('acme'), recordingDecider, each), {
        discard: true,
      }),
    ),
  );
  return run;
}

const playbooksStreamOfAcme = Option.getOrThrow(Option.fromNullishOr(addressedStreamOf(playbooksStreamOfOrg('acme'))));

function messageOf([event, context]: Recording, position: number): ProjectedMessage {
  return { id: `m${position}`, position, type: event.type, data: event.data, context };
}

describe('the playbooks of an org, kept as a row each in the transaction of every append', () => {
  it('are the registry the stream folds to, in the order they were created', async () => {
    const run = await playbooksKept();

    const rows = await run(
      Effect.flatMap(Ledger, (service) =>
        service.readProjectedRows(
          playbookRowsName,
          { org: 'acme' },
          { where: [], orderBy: ['created_position'], order: 'asc', limit: 10 },
        ),
      ),
    );
    const folded = history
      .map(([event, context]) => recorded(event, context))
      .reduce((registry, fact) => registryDecider.evolve(registry, fact), registryDecider.initialState);

    expect([...registryOfRows(rows)]).toStrictEqual([...folded]);
  });

  it('answer the status of each playbook, and unknown for one the org never had', async () => {
    const run = await playbooksKept();

    const statuses = await run(
      Effect.flatMap(PlaybookRegistry, (registry) =>
        Effect.forEach(['gamma', 'alpha', 'delta'], (playbook) => registry.status({ org: 'acme', playbook })),
      ),
    );

    expect(statuses).toEqual(['active', 'retired', 'unknown']);
  });

  it('change no row for a fact about a playbook the org does not have, or a fact they cannot read', () => {
    const unread = { id: 'm1', position: 1, type: 'playbook_created', data: {}, context: { by: ada.id, at: 'now' } };

    expect([
      playbookRows.rowAfter(undefined, messageOf([gammaRenamed, { by: editor, at: '2026-10-02T10:00:00.000Z' }], 3)),
      playbookRows.rowAfter(undefined, unread),
      playbookRows.keyOf?.(unread, playbooksStreamOfAcme),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
