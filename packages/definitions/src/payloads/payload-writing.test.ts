import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { PayloadsOutside } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Logger, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptArmOf } from '../testing/kept-payloads.ts';
import { payloadWritten, payloadWrittenIn } from './payload-writing.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const large = { leads: ['lead-1'], notes: 'n'.repeat(17_000) };

const kept = keptArmOf(large);

function outside<A, E>(effect: Effect.Effect<A, E>, keepsOutside = true) {
  return Effect.runPromise(effect.pipe(Effect.provideService(PayloadsOutside, keepsOutside)));
}

describe('a value written as a payload', () => {
  it('stays in its fact while the switch is off, whatever its size, and puts nothing', async () => {
    const { service } = memoryLedger();
    const written = payloadWrittenIn(service.content, alpha);

    expect(await outside(written({ inline: large }), false)).toEqual({ payload: { inline: large }, inHand: new Map() });
    expect(await Effect.runPromise(service.content.getHead(alpha, kept.sha256))).toBeUndefined();
  });

  it('is kept outside once past 16,384 bytes, put before any fact names it, with its value in hand', async () => {
    const { service } = memoryLedger();
    const written = payloadWrittenIn(service.content, alpha);

    expect(await outside(Effect.all([written({ inline: large }), written({ inline: 'small' })]))).toEqual([
      { payload: { kept }, inHand: new Map([[kept.sha256, large]]) },
      { payload: { inline: 'small' }, inHand: new Map() },
    ]);
    expect(await Effect.runPromise(service.content.getHead(alpha, kept.sha256))).toMatchObject({ bytes: kept.bytes });
  });

  it('is written as it is where it was kept outside already', async () => {
    const { service } = memoryLedger();

    expect(await outside(payloadWrittenIn(service.content, alpha)({ kept }))).toEqual({
      payload: { kept },
      inHand: new Map(),
    });
  });

  it('is kept in the playbook of the call where an operation writes it', async () => {
    const { service } = memoryLedger();
    const written = payloadWritten({ inline: large }).pipe(
      Effect.provideContext(playbookLedgerOf(service, alpha)),
      Effect.provideService(PlaybookContext, alpha),
    );

    expect(await outside(written)).toMatchObject({ payload: { kept } });
    expect(await Effect.runPromise(service.content.getHead(alpha, kept.sha256))).toMatchObject({ bytes: kept.bytes });
  });
});

describe('a value written as a payload while the switch is off', () => {
  it('is neither serialised nor measured, so the writer costs nothing more than before', async () => {
    const { service } = memoryLedger();
    const reads = { notes: 0 };
    const counted: Schema.Json = Object.defineProperty({}, 'notes', {
      enumerable: true,
      get: () => {
        reads.notes += 1;
        return large.notes;
      },
    });

    await outside(payloadWrittenIn(service.content, alpha)({ inline: counted }), false);

    expect(reads.notes).toBe(0);
  });
});

describe('a value written as a payload while the store of its content takes none', () => {
  it('is recorded inline, as the release before records it, where the store takes no value', async () => {
    const { service } = memoryLedger();
    const failing = { put: () => Effect.die(new Error('The bucket did not answer')) };

    expect(await outside(payloadWrittenIn(failing, alpha)({ inline: large }))).toEqual({
      payload: { inline: large },
      inHand: new Map(),
    });
    expect(await Effect.runPromise(service.content.getHead(alpha, kept.sha256))).toBeUndefined();
  });

  it('is told in a warning that names the bytes and the digest it could not keep', async () => {
    const warned: string[] = [];
    const warnings = Logger.layer([Logger.map(Logger.formatSimple, (line: string) => warned.push(line))]);
    const failing = { put: () => Effect.die(new Error('The bucket did not answer')) };

    await outside(payloadWrittenIn(failing, alpha)({ inline: large }).pipe(Effect.provide(warnings)));

    expect(warned.join('\n')).toContain(
      `The payload of ${kept.bytes} bytes under ${kept.sha256} could not be kept just now, so it is recorded inline in its fact`,
    );
  });
});
