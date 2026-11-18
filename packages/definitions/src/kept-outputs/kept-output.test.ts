import { Buffer } from 'node:buffer';

import { AssetKeeper, Conflict, PlaybookContext, playbookLedgerOf, type ValueKeeping } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { afterAToolThatMayAct } from '../runs/tool-refusals.ts';
import { keptOutputOf } from './kept-output.ts';

type ValueToKeep = Parameters<ValueKeeping['kept']>[1];

type Refused = Pick<Conflict, 'kind' | 'detail'>;

const playbook = { org: 'acme', playbook: 'alpha' };

const refusal = new Conflict({ detail: 'The playbook keeps all it may', kind: 'oversized' });

const run = {
  context: {
    by: 'acme-admin',
    runId: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
    definitionType: 'computation',
    definitionName: 'the-export',
    definitionVersion: 1,
  },
  lineage: { causationId: 'start-1', correlationId: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f' },
};

function referenceTo({ pointer, text, mediaType }: ValueToKeep) {
  return {
    id: `kept ${pointer}`,
    media_type: mediaType,
    bytes: Buffer.byteLength(text),
    sha256: 'e'.repeat(64),
    address: null,
    address_until: null,
  };
}

function keeping(refusing = false) {
  const asked: ValueToKeep[] = [];
  const keeper: ValueKeeping = {
    kept: (_run, value) => {
      asked.push(value);
      return refusing ? Effect.fail(refusal) : Effect.succeed(referenceTo(value));
    },
  };
  return { keeper, asked: () => asked.map(({ pointer }) => pointer) };
}

function keptOutput(keeper: ValueKeeping | null, output: Schema.Json, calledAToolThatMayChangeSomething: boolean) {
  return keptOutputOf(
    { output, record: {} },
    { run, schema: {}, calledAToolThatMayChangeSomething: Effect.succeed(calledAToolThatMayChangeSomething) },
  ).pipe(
    Effect.provide(playbookLedgerOf(memoryLedger().service, playbook)),
    Effect.provideService(PlaybookContext, playbook),
    Effect.provideService(AssetKeeper, keeper),
  );
}

function keptWith(keeper: ValueKeeping, output: Schema.Json) {
  return Effect.runPromiseExit(keptOutput(keeper, output, false));
}

function refusalOf(keeper: ValueKeeping | null, calledAToolThatMayChangeSomething: boolean) {
  return Effect.runPromise(Effect.flip(keptOutput(keeper, [large, large], calledAToolThatMayChangeSomething)));
}

const large = 'x'.repeat(700_000);

describe('an output kept in part as assets', () => {
  it('stands each kept member’s asset in its place, an item of a list or a member of an object, in its order', async () => {
    const list = keeping();
    const object = keeping();

    const keptList = await keptWith(list.keeper, [large, large, { rows: 2 }]);
    const keptObject = await keptWith(object.keeper, { title: 'The export', page: large, notes: large });

    expect([keptList, keptObject]).toEqual([
      Exit.succeed([
        referenceTo({ pointer: '/0', text: large, mediaType: 'text/plain; charset=utf-8' }),
        large,
        { rows: 2 },
      ]),
      Exit.succeed({
        title: 'The export',
        page: large,
        notes: referenceTo({ pointer: '/notes', text: large, mediaType: 'text/plain; charset=utf-8' }),
      }),
    ]);
    expect([list.asked(), object.asked()]).toEqual([['/0'], ['/notes']]);
  });

  it('stands the asset of the output kept whole in its place, and asks for nothing while the output fits', async () => {
    const whole = keeping();
    const small = keeping();

    expect([await keptWith(whole.keeper, 'y'.repeat(1_100_000)), await keptWith(small.keeper, { rows: 2 })]).toEqual([
      Exit.succeed(referenceTo({ pointer: '', text: 'y'.repeat(1_100_000), mediaType: 'text/plain; charset=utf-8' })),
      Exit.succeed({ rows: 2 }),
    ]);
    expect([whole.asked(), small.asked()]).toEqual([[''], []]);
  });

  it('ends with the keeper’s refusal, keeping nothing more', async () => {
    const refusing = keeping(true);

    expect(await keptWith(refusing.keeper, [large, large, large])).toEqual(Exit.fail(refusal));
    expect(refusing.asked()).toEqual(['/0']);
  });
});

describe('a refusal to keep the output of a run that called a tool that may change something', () => {
  it('says the tool ran and may have changed something, whether the keeper refused or no keeper is composed', async () => {
    const withNoTool = await refusalOf(null, false);

    const afterATool = [await refusalOf(keeping(true).keeper, true), await refusalOf(null, true)];

    expect(afterATool.map(({ kind, detail }: Readonly<Refused>) => ({ kind, detail }))).toEqual([
      { kind: 'oversized', detail: afterAToolThatMayAct(refusal.detail) },
      { kind: 'oversized', detail: afterAToolThatMayAct(withNoTool.detail) },
    ]);
  });
});
