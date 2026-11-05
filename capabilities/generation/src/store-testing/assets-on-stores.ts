import type { ContentOwner } from '@on.auto/content';
import { Ledger, playbookRowsOf, streamPrefixOfPlaybook, type Context } from '@on.auto/operations';
import { Effect, type Layer } from 'effect';
import { expect, it } from 'vitest';

import { assetDecider } from '../assets/asset-decider.ts';
import type { AssetKeptData } from '../assets/asset-facts.ts';
import { assets, assetsName, assetTotals, assetTotalsName } from '../assets/asset-projections.ts';

export type LedgerOn = (projections: readonly (typeof assets)[]) => Promise<Layer.Layer<Ledger>>;

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const shared = 'a'.repeat(64);

const own = 'b'.repeat(64);

const at = '2026-11-01T10:00:00.000Z';

function keptOf(sha256: string, bytes: number, expiresAt: string): AssetKeptData {
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

function kept(playbook: ContentOwner, id: string, data: AssetKeptData) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`${streamPrefixOfPlaybook(playbook)}assets/${id}`, assetDecider, {
      event: { type: 'asset_kept', data },
      context: onTheRun,
    }),
  );
}

function expired(playbook: ContentOwner, id: string, bytes: number) {
  return Effect.flatMap(Effect.service(Ledger), (ledger) =>
    ledger.execute(`${streamPrefixOfPlaybook(playbook)}assets/${id}`, assetDecider, {
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
    due: playbookRowsOf(assetsName, due).map(({ playbook, key }) => `${playbook}/${key}`),
    next: yield* ledger.nextDueOf(assetsName, 'expires_at', Date.parse(at)),
    totals: yield* ledger.readProjectedRows(assetTotalsName, alpha, {
      where: [{ column: 'row_key', equals: 'playbook' }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  };
});

export function assetsOnStoresSuite(ledgerOn: LedgerOn): void {
  it('projects each asset and the bytes of each playbook, and finds what is due across playbooks', async () => {
    const layer = await ledgerOn([assets, assetTotals]);
    const program = Effect.gen(function* () {
      yield* kept(alpha, 'one', keptOf(shared, 100, '2026-11-02T10:00:00.000Z'));
      yield* kept(alpha, 'two', keptOf(shared, 100, '2026-11-20T10:00:00.000Z'));
      yield* kept(alpha, 'three', keptOf(own, 50, '2026-11-10T10:00:00.000Z'));
      yield* kept(beta, 'four', keptOf(shared, 100, '2026-11-05T10:00:00.000Z'));
      const before = yield* readings;
      yield* expired(alpha, 'one', 100);
      return { before, after: yield* readings };
    });

    const { before, after } = await Effect.runPromise(Effect.provide(program, layer));

    expect(before).toEqual({
      due: ['alpha/one', 'beta/four', 'alpha/three', 'alpha/two'],
      next: Date.parse('2026-11-02T10:00:00.000Z'),
      totals: [{ org: 'acme', playbook: 'alpha', key: 'playbook', row: { bytes: 250, assets: 3 } }],
    });
    expect(after).toEqual({
      due: ['beta/four', 'alpha/three', 'alpha/two'],
      next: Date.parse('2026-11-05T10:00:00.000Z'),
      totals: [{ org: 'acme', playbook: 'alpha', key: 'playbook', row: { bytes: 150, assets: 2 } }],
    });
  });
}
