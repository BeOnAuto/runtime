import { readFileSync } from 'node:fs';

import { sha256Of } from '@on.auto/content';
import { PlaybookContext, playbookLedgerOf, runStreamNameOf, streamPrefixOfPlaybook } from '@on.auto/operations';
import { PayloadOffloading, PayloadSizeThreshold, textBytesOf } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Logger, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { harness } from '../testing/harness.ts';
import { keptArmOf, watchedStore } from '../testing/kept-payloads.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';
import {
  definitionFactsStored,
  everyWayOfSaving,
  longerThanAFactHolds,
  savingAFunction,
  savingAWorkflow,
} from '../testing/saved-definitions.ts';
import { isTheSameText, textMembersOf, textsAsWritten, textsOf } from './definition-texts.ts';
import { textRead, textsByDigestOf, TextsInHand, textsWritten } from './kept-texts.ts';
import { payloadWritten, payloadWrittenIn, recordWritten } from './payload-writing.ts';
import { outputsKeptIn, resultedAlone } from './settled-outputs.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const large = { leads: ['lead-1'], notes: 'n'.repeat(17_000) };

const kept = keptArmOf(large);

function promptOfBytes(bytes: number): string {
  return 'w'.repeat(bytes - '""'.length);
}

function outside<A, E>(effect: Effect.Effect<A, E>, keepsOutside = true) {
  return Effect.runPromise(effect.pipe(Effect.provideService(PayloadOffloading, keepsOutside)));
}

const keptDefinitionTexts = { kept: { sha256: sha256Of('a document'), bytes: 10 } };

const asTheReleaseBeforeWroteThem = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(
  readFileSync(new URL('definition-facts-written-inline.json', import.meta.url), 'utf8'),
);

const Stored = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
);

function withoutTheIdentity(text: string): string {
  const { type, data } = Schema.decodeUnknownSync(Stored)(text);
  const { definition_id: _id, playbook: _playbook, ...before } = data;
  return JSON.stringify({ type, data: type === 'definition_created' ? before : data });
}

const Identified = Schema.fromJsonString(
  Schema.Struct({ data: Schema.Struct({ definition_id: Schema.String, playbook: Schema.String }) }),
);

function identityOf(text: string): string {
  return Schema.decodeUnknownSync(Identified)(text).data.playbook;
}

const long = longerThanAFactHolds('A document longer than a fact holds.');

const keptKeptTexts = { sha256: sha256Of(long), bytes: textBytesOf(long) };

const neverStarted = '0199a3c4-7d2e-7c1a-9b3f-000000000000';

function streamOf(id: string): string {
  return `${streamPrefixOfPlaybook(alpha)}${runStreamNameOf(id)}`;
}

const rejected = resultedAlone({
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'Busy' } },
});

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

describe('a value written as a payload under the threshold the shell gives', () => {
  it('is kept outside past the threshold the shell gives, and stays in its fact at it', async () => {
    const { service } = memoryLedger();
    const written = payloadWrittenIn(service.content, alpha);
    const atIt = 'a'.repeat(4094);
    const pastIt = 'p'.repeat(4095);
    const underAThresholdOf = (threshold: number) =>
      outside(
        Effect.all([written({ inline: atIt }), written({ inline: pastIt }), written({ inline: large })]).pipe(
          Effect.provideService(PayloadSizeThreshold, threshold),
        ),
      );

    expect((await underAThresholdOf(4096)).map(({ payload }) => 'kept' in payload)).toEqual([false, true, true]);
    expect((await underAThresholdOf(65_536)).map(({ payload }) => 'kept' in payload)).toEqual([false, false, false]);
  });

  it.each([2048, 16_384, 65_536])(
    'keeps the prompt of a record in it at a threshold of %i bytes, and by its digest and size a byte past it',
    async (threshold) => {
      const { service } = memoryLedger();
      const [atIt, pastIt] = [promptOfBytes(threshold), promptOfBytes(threshold + 1)];
      const writtenUnder = (prompt: string) =>
        outside(
          recordWritten({ model: 'm', prompt }, payloadWrittenIn(service.content, alpha)).pipe(
            Effect.provideService(PayloadSizeThreshold, threshold),
          ),
        );
      const keptPastIt = keptArmOf(pastIt);

      expect((await writtenUnder(atIt)).record).toEqual({ model: 'm', prompt: atIt });
      expect((await writtenUnder(pastIt)).record).toEqual({
        model: 'm',
        prompt_sha256: keptPastIt.sha256,
        prompt_bytes: threshold + 1,
      });
      expect(await Effect.runPromise(service.content.getHead(alpha, keptPastIt.sha256))).toMatchObject({
        bytes: threshold + 1,
      });
    },
  );
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

describe('the prompt of a record written while the store of its content takes none', () => {
  it('stays in the record, member for member, and a warning names the bytes and the digest it could not keep', async () => {
    const warned: string[] = [];
    const warnings = Logger.layer([Logger.map(Logger.formatSimple, (line: string) => warned.push(line))]);
    const failing = { put: () => Effect.die(new Error('The bucket did not answer')) };
    const record = { model: 'm', prompt: large, duration_ms: 5 };

    const written = await outside(
      recordWritten(record, payloadWrittenIn(failing, alpha)).pipe(Effect.provide(warnings)),
    );

    expect(JSON.stringify(written.record)).toBe(JSON.stringify(record));
    expect(warned.join('\n')).toContain(
      `The payload of ${kept.bytes} bytes under ${kept.sha256} could not be kept just now, so it is recorded inline in its fact`,
    );
  });
});

describe('the texts of a definition as its fact records them', () => {
  it('are each read from its arm, inline or kept, and written back to the same members', () => {
    const members = { source_sha256: keptDefinitionTexts.kept.sha256, source_bytes: 10, overview: 'An overview' };

    expect(textsOf(members)).toEqual({ source: keptDefinitionTexts, overview: { inline: 'An overview' } });
    expect(textMembersOf(textsOf(members))).toEqual(members);
    expect(textsOf({ source: 'a document', diagram: 'none' })).toEqual(
      textsAsWritten({ source: 'a document', diagram: 'none' }),
    );
  });
});

describe('two texts of a definition, compared without a read', () => {
  it('are the same where both are absent, the same text inline, or a text inline and one kept by its digest', () => {
    expect([
      isTheSameText(),
      isTheSameText({ inline: 'a document' }, { inline: 'a document' }),
      isTheSameText({ inline: 'a document' }, keptDefinitionTexts),
      isTheSameText(keptDefinitionTexts, { kept: { ...keptDefinitionTexts.kept } }),
    ]).toEqual([true, true, true, true]);
  });

  it('differ where one is absent, the texts differ, or a text inline that no store could keep meets a kept one', () => {
    const replaced = `a document${String.fromCodePoint(0xd800)}`;

    expect([
      isTheSameText(undefined, keptDefinitionTexts),
      isTheSameText({ inline: 'a document' }),
      isTheSameText({ inline: 'another document' }, keptDefinitionTexts),
      isTheSameText({ inline: replaced }, { kept: { sha256: sha256Of(replaced), bytes: 13 } }),
      isTheSameText({ inline: replaced }, { inline: 'a document�' }),
    ]).toEqual([false, false, false, false, false]);
  });
});

describe('the facts of a definition saved while its playbook keeps nothing outside them', () => {
  it('are stored as the text the release before stored, member for member, for a workflow and a function, through every way a definition is saved, and read nothing', async () => {
    const watched = watchedStore();
    const definitions = harness(undefined, watched.store);
    await everyWayOfSaving(definitions, savingAWorkflow);
    await everyWayOfSaving(definitions, savingAFunction);

    const stored = await definitionFactsStored(definitions);

    expect(stored.map((text) => withoutTheIdentity(text))).toEqual(asTheReleaseBeforeWroteThem);
    expect(stored.filter((text) => text.includes('"definition_created"')).map((text) => identityOf(text))).toEqual([
      'alpha',
      'alpha',
    ]);
    expect(watched.reads()).toBe(0);
  });
});

describe('the texts of a definition written for its fact', () => {
  it('keep a text written twice, as its document and its overview, once, under one digest', async () => {
    const watched = watchedStore();
    const { service } = memoryLedger(undefined, [], undefined, watched.store);
    const written = await Effect.runPromise(
      textsWritten({ source: long, overview: long, diagram: 'none' }).pipe(
        Effect.provideContext(playbookLedgerOf(service, alpha)),
        Effect.provideService(PlaybookContext, alpha),
        Effect.provideService(PayloadOffloading, true),
      ),
    );

    expect(written).toEqual({
      texts: { source: { kept: keptKeptTexts }, overview: { kept: keptKeptTexts }, diagram: { inline: 'none' } },
      inHand: new Map([[keptKeptTexts.sha256, long]]),
    });
  });

  it('are named by digest, for those kept outside the fact, beside the texts read', () => {
    expect(
      textsByDigestOf(
        { source: { kept: keptKeptTexts }, overview: { inline: 'An overview' } },
        { source: long, overview: 'An overview' },
      ),
    ).toEqual(new Map([[keptKeptTexts.sha256, long]]));
  });
});

describe('a text of a definition read', () => {
  it('is the one in hand where its digest is, with no read of the store', async () => {
    const watched = watchedStore();
    const { service } = memoryLedger(undefined, [], undefined, watched.store);

    expect(
      await Effect.runPromise(
        textRead('overview', { kept: keptKeptTexts }).pipe(
          Effect.provideService(TextsInHand, new Map([[keptKeptTexts.sha256, long]])),
          Effect.provideContext(playbookLedgerOf(service, alpha)),
          Effect.provideService(PlaybookContext, alpha),
        ),
      ),
    ).toBe(long);
    expect(watched.reads()).toBe(0);
  });
});

describe('the values the settler that keeps outputs reads to compare a settlement', () => {
  it('are none for a run never started, nor for a run whose ending or offer is no success', async () => {
    const handed = await withHandOn();
    await handed.running();
    await handed.settling({ status: 'succeeded', output: { small: true }, record: {} });
    const { toCompare } = outputsKeptIn(handed.ledger.service);

    const read = await handed.run(
      Effect.orDie(
        Effect.all([
          toCompare({ run: alpha, stream: streamOf(neverStarted), offered: rejected }),
          toCompare({ run: alpha, stream: streamOf(relayedId), offered: rejected }),
        ]),
      ),
      settledAt,
    );

    expect(read).toEqual([new Map(), new Map()]);
  });
});
