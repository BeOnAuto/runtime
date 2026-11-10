import { textToKeep, type UnheldRemoval } from '@on.auto/content';
import { at, json } from '@on.auto/content/testing';
import { Effect, Result, Schema } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { contentHoldersOf, type ContentHolders } from '../held-content/content-declaration.ts';
import { keptContentGraceMs } from '../held-content/unheld-removal.ts';
import { ActedContextSchema, type Context } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { FactScrub } from '../ledger/fact-scrub.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';

const AttachedSchema = Schema.Struct({ sha256: Schema.String });

const NoteKeptSchema = factOf(
  'note_kept',
  Schema.Struct({ sha256: Schema.optionalKey(Schema.String), attached: Schema.optionalKey(AttachedSchema) }),
  ActedContextSchema,
  { content: { holds: ['/sha256', '/attached/sha256'] } },
);

const NoteLetGoSchema = factOf('note_let_go', Schema.Struct({ sha256: Schema.String }), ActedContextSchema, {
  content: { releases: ['/sha256'] },
});

const NotesClosedSchema = factOf('notes_closed', Schema.Struct({}), ActedContextSchema, {
  content: { releases: 'all' },
});

const NoteErasedSchema = factOf('note_erased', Schema.Struct({ position: Schema.Int }), ActedContextSchema);

const NotePartSchema = Schema.Struct({ sha256: Schema.String, bytes: Schema.Number });

const NoteWrittenSchema = factOf(
  'note_written',
  Schema.Struct({
    body: Schema.optionalKey(Schema.String),
    body_sha256: Schema.optionalKey(Schema.String),
    body_bytes: Schema.optionalKey(Schema.Number),
    parts: Schema.optionalKey(Schema.Array(NotePartSchema)),
  }),
  ActedContextSchema,
  {
    content: {
      payloads: [
        { sha256: '/body_sha256', bytes: '/body_bytes' },
        { sha256: '/parts/*/sha256', bytes: '/parts/*/bytes' },
      ],
    },
  },
);

const HeldNoteFactSchema = Schema.Union([NoteKeptSchema, NoteLetGoSchema, NotesClosedSchema, NoteErasedSchema]);

const WrittenNoteFactSchema = Schema.Union([NoteWrittenSchema]);

type RecordedHeldNote = typeof HeldNoteFactSchema.Type;

type RecordedWrittenNote = typeof WrittenNoteFactSchema.Type;

export type HeldNote = Decided<RecordedHeldNote>;

export type WrittenNote = Decided<RecordedWrittenNote>;

export interface UnheldContentEntry {
  readonly aLedger: (holders: ContentHolders) => Promise<LedgerPorts>;
}

export const noteHolders: ContentHolders = contentHoldersOf([HeldNoteFactSchema, WrittenNoteFactSchema]);

const notedContext: Context = { at: '2026-11-01T09:00:00.000Z', by: 'noter' };

export const heldNotes: Decider<null, readonly HeldNote[], RecordedHeldNote> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => notedContext,
  eventSchema: HeldNoteFactSchema,
};

export const writtenNotes: Decider<null, readonly WrittenNote[], RecordedWrittenNote> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => notedContext,
  eventSchema: WrittenNoteFactSchema,
};

export const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

export const anHour = keptContentGraceMs;

export const firstNotes = 'playbook/acme/alpha/notes/n1';

export const secondNotes = 'playbook/acme/alpha/notes/n2';

export const notesOfTheOrg = 'org/acme/notes/n1';

export const firstWritings = 'playbook/acme/alpha/writings/w1';

export function kept(sha256: string): HeldNote {
  return { type: 'note_kept', data: { sha256 } };
}

export function attached(sha256: string): HeldNote {
  return { type: 'note_kept', data: { attached: { sha256 } } };
}

export function letGo(sha256: string): HeldNote {
  return { type: 'note_let_go', data: { sha256 } };
}

export const closed: HeldNote = { type: 'notes_closed', data: {} };

export function written(data: WrittenNote['data']): WrittenNote {
  return { type: 'note_written', data };
}

export function erasing(position: number, data: Schema.JsonObject): FactScrub<RecordedHeldNote> {
  return {
    eventSchema: HeldNoteFactSchema,
    data,
    erasure: { type: 'note_erased', data: { position } },
    context: notedContext,
  };
}

export async function keptIn(
  ledger: LedgerPorts,
  playbook: PlaybookAddress,
  text: string,
  moment: number,
): Promise<string> {
  return (await at(moment, ledger.content.put(playbook, textToKeep(text, json)))).sha256;
}

export function noted(ledger: LedgerPorts, stream: string, ...facts: readonly HeldNote[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, heldNotes, facts));
}

export function wrote(ledger: LedgerPorts, stream: string, ...facts: readonly WrittenNote[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, writtenNotes, facts));
}

export function removedAt(
  ledger: LedgerPorts,
  moment: number,
  playbook: PlaybookAddress,
  sha256: string,
): Promise<UnheldRemoval> {
  return at(moment, ledger.removeUnheld(playbook, sha256));
}
