import {
  ActedContextSchema,
  changingNothing,
  factOf,
  type Decided,
  type Decider,
  type Lineage,
  type Outcome,
  type PresentedFact,
  type Presenter,
} from '@on.auto/operations';
import { memoryPlaybookRegistry } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

import { defineListPlaybookEvents } from '../feed/list-playbook-events.ts';
import { acmeAdmin } from './callers.ts';
import { harness, toPlaybook } from './harness.ts';

const TextSchema = Schema.Struct({ text: Schema.String });

const FactSchema = Schema.Union([
  factOf('added', TextSchema, ActedContextSchema),
  factOf('hidden', TextSchema, ActedContextSchema),
  factOf('kept', TextSchema, ActedContextSchema),
  factOf('moved', TextSchema, ActedContextSchema),
]);

export type Fact = Decided<typeof FactSchema.Type>;

interface Recording {
  readonly fact: Fact;
  readonly at: string;
}

export const recorder: Decider<null, Recording, typeof FactSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ at }) => ({ at, by: 'acme-admin' }),
  eventSchema: FactSchema,
};

const decodeText = Schema.decodeUnknownSync(TextSchema);

function eventOf(type: string, text: string, part?: number): PresentedFact {
  const fact = { type, summary: 'Something happened.', data: { text } };
  return part === undefined ? fact : { ...fact, part: { number: part, causedBy: part - 1 } };
}

export function presenterOf(streamKind: string, publicNames: Readonly<Record<string, string | null>>): Presenter {
  return {
    streamKind,
    publicNames: Object.fromEntries(
      Object.entries(publicNames).map(([stored, name]: readonly [string, string | null]) => [
        stored,
        name === null ? [] : [name],
      ]),
    ),
    present: (recorded) => [eventOf(String(publicNames[recorded.type]), decodeText(recorded.data).text)],
    changes: changingNothing(Object.keys(publicNames)),
  };
}

const notes = presenterOf('notes', { added: 'note_added', hidden: null, kept: 'note_kept' });

const shelves = presenterOf('shelves', { added: 'shelf_filled' });

const steps: Presenter = {
  streamKind: 'run-logs',
  publicNames: { moved: ['run_moved', 'run_stepped'] },
  present: (recorded) => {
    const { text } = decodeText(recorded.data);
    return [eventOf('run_moved', text), ...[1, 2].map((step) => eventOf('run_stepped', `${text}${step}`, step))];
  },
  changes: changingNothing(['moved']),
};

export const listPlaybookEvents = defineListPlaybookEvents([notes, shelves, steps]);

const playbooks = memoryPlaybookRegistry(
  [
    { org: 'acme', playbook: 'alpha' },
    { org: 'globex', playbook: 'gamma' },
  ],
  [{ org: 'acme', playbook: 'old' }],
);

export const toAlpha = toPlaybook('acme', 'alpha');

const TextsSchema = Schema.Struct({
  output: Schema.Struct({
    events: Schema.Array(Schema.Struct({ data: Schema.Struct({ text: Schema.String }) })),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

export const textsOf = Schema.decodeUnknownSync(TextsSchema);

export function textsIn(outcome: Outcome): readonly string[] {
  return textsOf(outcome).output.events.map(({ data }) => data.text);
}

export function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

export function playbookFeed() {
  const feed = harness(playbooks);
  let minute = 0;
  const recordingWith = (stream: string, fact: Fact, lineage?: Lineage, playbook = 'playbook/acme/alpha') => {
    minute += 1;
    const at = `2026-10-01T09:${String(minute).padStart(2, '0')}:00.000Z`;
    return feed.run(
      Effect.orDie(feed.ledger.service.execute(`${playbook}/${stream}`, recorder, { fact, at }, lineage)),
      at,
    );
  };
  const recording = (stream: string, type: Fact['type'], text: string, playbook = 'playbook/acme/alpha') =>
    recordingWith(stream, { type, data: { text } }, undefined, playbook);
  const reading = (input: object = {}) => feed.callInPlaybook(listPlaybookEvents, toAlpha(acmeAdmin, input));
  return { ...feed, recording, recordingWith, reading };
}

export async function playbookWithEvents() {
  const feed = playbookFeed();
  await feed.recording('notes', 'added', 'a');
  await feed.recording('shelves/red', 'added', 'b');
  await feed.recording('notes', 'hidden', 'c');
  await feed.recording('secrets', 'added', 'd');
  await feed.recording('notes', 'kept', 'e');
  return feed;
}

export async function everyText(
  read: (cursor: string | undefined) => Promise<Outcome>,
  between: () => Promise<unknown>,
  cursor?: string,
): Promise<readonly string[]> {
  const page = await read(cursor);
  await between();
  const { next_cursor: next } = textsOf(page).output;
  return [...textsIn(page), ...(next === null ? [] : await everyText(read, between, next))];
}
