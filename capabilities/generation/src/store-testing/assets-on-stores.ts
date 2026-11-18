import { Conflict, Ledger, playbookRowsOf, type Context } from '@on.auto/operations';
import { definitionsPlaced, remarkFacts } from '@on.auto/operations/testing';
import { Effect, Schema, type Layer } from 'effect';
import { expect, it } from 'vitest';

import { assetDecider } from '../assets/asset-decider.ts';
import type { AssetKeptDataWritten } from '../assets/asset-facts.ts';
import { assets, assetsName, assetTotals, assetTotalsName } from '../assets/asset-projections.ts';
import { roomLeft } from '../run/asset-room.ts';

export type LedgerOn = (projections: readonly (typeof assets)[]) => Promise<Layer.Layer<Ledger>>;

const alpha = { org: 'acme', playbook: 'alpha' };

const decodePlacement = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

export const definitionsPlacedApart: typeof definitionsPlaced = {
  ...definitionsPlaced,
  nameAfter: (_held, { stream, data }) => ({
    playbookKey: `playbook/acme/${decodePlacement(data).text}/`,
    definitionType: 'generation',
    name: stream,
    status: 'active',
    hasTriggers: false,
  }),
};

const shared = 'a'.repeat(64);

const own = 'b'.repeat(64);

const at = '2026-11-01T10:00:00.000Z';

function keptOf(sha256: string, bytes: number, expiresAt: string): AssetKeptDataWritten {
  return {
    media_type: 'image/png',
    bytes,
    sha256,
    kind: 'image',
    made_by: {
      generation: {
        model: 'gateway/openai/gpt-image-2',
        prompt: 'A lighthouse',
        parameters: {},
        references: [],
        own_key: true,
      },
    },
    expires_at: expiresAt,
  };
}

const onTheRun: Context = {
  at,
  by: 'acme-admin',
  runId: 'run-1',
  definitionType: 'generation',
  definitionName: 'picture',
  definitionVersion: 1,
};

function placed(definition: string, playbook: string) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`definition/acme/${definition}/remarks/placed`, remarkFacts, [
      { type: 'remark_made', data: { text: playbook } },
    ]),
  );
}

function kept(definition: string, id: string, data: AssetKeptDataWritten) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`definition/acme/${definition}/assets/${id}`, assetDecider, {
      event: { type: 'asset_kept', data },
      context: onTheRun,
    }),
  );
}

function expired(definition: string, id: string, bytes: number) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`definition/acme/${definition}/assets/${id}`, assetDecider, {
      event: { type: 'asset_expired', data: { bytes } },
      context: { at: '2026-11-02T10:00:00.000Z', by: 'runtime' },
    }),
  );
}

const readings = Effect.gen(function* () {
  const ledger = yield* Effect.service(Ledger);
  const due = yield* ledger.readDueRows(assetsName, {
    column: 'expires_at',
    through: Date.parse('2026-12-31T00:00:00.000Z'),
    limit: 10,
  });
  return {
    due: playbookRowsOf(assetsName, due).map(({ playbook, definition, key }) => [playbook, definition, key].join('/')),
    next: yield* ledger.nextDueOf(assetsName, 'expires_at', Date.parse(at)),
    totals: yield* ledger.readProjectedRows(assetTotalsName, alpha, {
      where: [],
      orderBy: [],
      order: 'asc',
      limit: 10,
    }),
  };
});

function roomIn(most: number) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) => Effect.as(roomLeft(ledger, alpha, most), 'room'));
}

function refusalIn(most: number) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) => Effect.flip(roomLeft(ledger, alpha, most)));
}

const manyDefinitions = Array.from({ length: 101 }, (_, index) => `d${String(index).padStart(3, '0')}`);

function assetsOfDefinitions(ledgerOn: LedgerOn): void {
  it('projects each asset under the definition of the run that kept it, and the bytes of each definition, and finds what is due across playbooks', async () => {
    const layer = await ledgerOn([assets, assetTotals]);
    const program = Effect.gen(function* () {
      yield* placed('d1', 'alpha');
      yield* placed('d2', 'alpha');
      yield* placed('d3', 'beta');
      yield* kept('d1', 'one', keptOf(shared, 100, '2026-11-02T10:00:00.000Z'));
      yield* kept('d1', 'two', keptOf(shared, 100, '2026-11-20T10:00:00.000Z'));
      yield* kept('d2', 'three', keptOf(own, 50, '2026-11-10T10:00:00.000Z'));
      yield* kept('d3', 'four', keptOf(shared, 100, '2026-11-05T10:00:00.000Z'));
      const before = yield* readings;
      yield* expired('d1', 'one', 100);
      return { before, after: yield* readings };
    });

    const { before, after } = await Effect.runPromise(Effect.provide(program, layer));

    expect(before).toEqual({
      due: ['alpha/d1/one', 'beta/d3/four', 'alpha/d2/three', 'alpha/d1/two'],
      next: Date.parse('2026-11-02T10:00:00.000Z'),
      totals: [
        { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'd1', row: { bytes: 200, assets: 2 } },
        { org: 'acme', playbook: 'alpha', definition: 'd2', key: 'd2', row: { bytes: 50, assets: 1 } },
      ],
    });
    expect(after).toEqual({
      due: ['beta/d3/four', 'alpha/d2/three', 'alpha/d1/two'],
      next: Date.parse('2026-11-05T10:00:00.000Z'),
      totals: [
        { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'd1', row: { bytes: 100, assets: 1 } },
        { org: 'acme', playbook: 'alpha', definition: 'd2', key: 'd2', row: { bytes: 50, assets: 1 } },
      ],
    });
  });
}

function boundOfAPlaybook(ledgerOn: LedgerOn): void {
  it('bounds what a playbook keeps by the bytes of all its definitions together, and of no other playbook', async () => {
    const layer = await ledgerOn([assets, assetTotals]);
    const program = Effect.gen(function* () {
      yield* placed('d1', 'alpha');
      yield* placed('d2', 'alpha');
      yield* placed('d3', 'beta');
      yield* kept('d1', 'one', keptOf(shared, 600, '2026-11-20T10:00:00.000Z'));
      yield* kept('d2', 'two', keptOf(own, 600, '2026-11-20T10:00:00.000Z'));
      yield* kept('d3', 'three', keptOf(own, 5000, '2026-11-20T10:00:00.000Z'));
      return { room: yield* roomIn(1201), refused: yield* refusalIn(1000) };
    });

    expect(await Effect.runPromise(Effect.provide(program, layer))).toEqual({
      room: 'room',
      refused: new Conflict({
        detail: 'The playbook keeps 1.2 KiB of assets, and may keep 1,000 bytes; an asset makes room as it expires',
        kind: 'oversized',
      }),
    });
  });
}

function boundPastAPage(ledgerOn: LedgerOn): void {
  it('counts the bytes of every definition of a playbook, past the first page of its definitions', async () => {
    const layer = await ledgerOn([assets, assetTotals]);
    const program = Effect.gen(function* () {
      for (const definition of manyDefinitions) {
        yield* placed(definition, 'alpha');
        yield* kept(definition, `of-${definition}`, keptOf(own, 1, '2026-11-20T10:00:00.000Z'));
      }
      return { room: yield* roomIn(102), refused: yield* refusalIn(101) };
    });

    expect(await Effect.runPromise(Effect.provide(program, layer))).toEqual({
      room: 'room',
      refused: new Conflict({
        detail: 'The playbook keeps 101 bytes of assets, and may keep 101 bytes; an asset makes room as it expires',
        kind: 'oversized',
      }),
    });
  });
}

export function assetsOnStoresSuite(ledgerOn: LedgerOn): void {
  assetsOfDefinitions(ledgerOn);
  boundOfAPlaybook(ledgerOn);
  boundPastAPage(ledgerOn);
}
