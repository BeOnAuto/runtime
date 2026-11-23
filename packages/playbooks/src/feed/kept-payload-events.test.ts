import { createHash } from 'node:crypto';

import {
  ActedContextSchema,
  Ledger,
  type Lineage,
  ServedAsTool,
  changingNothing,
  contentHoldersOf,
  factOf,
  makeDispatcher,
  messageIdOf,
  type Decided,
  type Decider,
  type Presenter,
} from '@on.auto/operations';
import {
  payloadFields,
  payloadKept,
  payloadPointersOf,
  textBytesOf,
  textPayloadText,
  withPayloads,
} from '@on.auto/operations/payloads';
import { memoryLedger, memoryPlaybookRegistry } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineGetEvent, defineGetRunTree, playbookRows } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const NotedSchema = Schema.Union([
  factOf(
    'noted',
    withPayloads(Schema.Struct({ ...payloadFields('text', Schema.String), title: Schema.String }), ['text']),
    ActedContextSchema,
    { content: { payloads: [payloadPointersOf('text')] } },
  ),
]);

type Noted = Decided<typeof NotedSchema.Type>;

const noting: Decider<null, { readonly fact: Noted; readonly at: string }, typeof NotedSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ at }) => ({ at, by: 'acme-admin' }),
  eventSchema: NotedSchema,
};

const decodeNoted = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String, text_sha256: Schema.String }));

const notes: Presenter = {
  streamKind: 'notes',
  publicNames: { noted: ['note_noted'] },
  present: ({ data }, content) => {
    const { title, text_sha256: sha256 } = decodeNoted(data);
    return [{ type: 'note_noted', summary: 'A note was noted.', data: { title, text: content(sha256) ?? null } }];
  },
  changes: changingNothing(['noted']),
};

const notedHolders = contentHoldersOf([NotedSchema]);

const getEvent = defineGetEvent([notes], notedHolders);

const titlesOnly: Presenter = {
  ...notes,
  present: ({ data }) => [
    { type: 'note_noted', summary: 'A note was noted.', data: { title: decodeNoted(data).title } },
  ],
};

const getTitle = defineGetEvent([titlesOnly], contentHoldersOf([NotedSchema]));

const toAlpha = toPlaybook('acme', 'alpha');

const alphaKnown = memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]);

const at = '2026-10-01T09:01:00.000Z';

const pastTheHour = '2026-10-01T10:02:00.000Z';

function aFeed() {
  return harness(alphaKnown, memoryLedger(undefined, [playbookRows], notedHolders));
}

function toKeep(text: string) {
  return {
    ...textPayloadText(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: textBytesOf(text),
  };
}

function notedIn(feed: ReturnType<typeof harness>, number: number, text: string) {
  const payload = toKeep(text);
  const put = payloadKept(feed.ledger.service.content, { org: 'acme', playbook: 'alpha' }, payload);
  const { sha256, bytes } = payload;
  const fact: Noted = { type: 'noted', data: { text_sha256: sha256, text_bytes: bytes, title: `${number}` } };
  return feed.run(
    Effect.orDie(put).pipe(
      Effect.andThen(feed.ledger.service.execute(`playbook/acme/alpha/notes/${number}`, noting, { fact, at })),
      Effect.orDie,
    ),
    at,
  );
}

function eventOf(number: number) {
  return toAlpha(acmeAdmin, { event_id: messageIdOf(`playbook/acme/alpha/notes/${number}`, 1) });
}

function unreachableContent(ledger: Ledger['Service']): Ledger['Service'] {
  return { ...ledger, content: { ...ledger.content, get: () => Effect.die(new Error('connect ECONNREFUSED')) } };
}

function withItsStoreLosing(ledger: Ledger['Service'], text: string): Ledger['Service'] {
  const lost = toKeep(text).sha256;
  return {
    ...ledger,
    content: {
      ...ledger.content,
      get: (owner, sha256) => (sha256 === lost ? Effect.undefined : ledger.content.get(owner, sha256)),
    },
  };
}

function readPastTheHour(feed: ReturnType<typeof harness>, ledger: Ledger['Service'], number: number) {
  return feed.run(
    makeDispatcher([])
      .dispatchToPlaybook(getEvent.registration, eventOf(number))
      .pipe(Effect.provideService(Ledger, ledger)),
    pastTheHour,
  );
}

describe('one event of a fact that offloads a payload, read whole', () => {
  it('reads the payload through the reader of payloads, and shows one missing from the content as the fact holds it', async () => {
    const feed = aFeed();
    await notedIn(feed, 1, 'n'.repeat(3000));
    await notedIn(feed, 2, 'gone');
    const losingGone = withItsStoreLosing(feed.ledger.service, 'gone');

    expect([await readPastTheHour(feed, losingGone, 1), await readPastTheHour(feed, losingGone, 2)]).toMatchObject([
      { status: 'succeeded', output: { type: 'note_noted', data: { title: '1', text: 'n'.repeat(3000) } } },
      { status: 'succeeded', output: { type: 'note_noted', data: { title: '2', text: null } } },
    ]);
  });

  it('reads as a tool a payload within 64 KiB, and leaves one past it unread, as its size', async () => {
    const feed = aFeed();
    await notedIn(feed, 1, 's'.repeat(65_536));
    await notedIn(feed, 2, 'l'.repeat(65_537));
    const asTool = (number: number) =>
      feed.run(
        makeDispatcher([])
          .dispatchToPlaybook(getEvent.registration, eventOf(number))
          .pipe(Effect.provideService(ServedAsTool, true)),
      );

    expect([await asTool(1), await asTool(2)]).toMatchObject([
      { status: 'succeeded', output: { data: { title: '1', text: 's'.repeat(65_536) } } },
      { status: 'succeeded', output: { data: { title: '2', text: null } } },
    ]);
  });

  it('is unavailable, to be asked again, while the content cannot be reached', async () => {
    const feed = aFeed();
    await notedIn(feed, 1, 'n'.repeat(3000));
    const unreachable = feed.run(
      makeDispatcher([])
        .dispatchToPlaybook(getEvent.registration, eventOf(1))
        .pipe(Effect.provideService(Ledger, unreachableContent(feed.ledger.service))),
    );

    expect(await unreachable).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });
});

describe('one event of a fact that offloads a payload, read whole by a presenter that shows none', () => {
  it('reads no payload, so it answers while the content cannot be reached', async () => {
    const feed = aFeed();
    await notedIn(feed, 1, 'n'.repeat(3000));
    const unreachable = feed.run(
      makeDispatcher([])
        .dispatchToPlaybook(getTitle.registration, eventOf(1))
        .pipe(Effect.provideService(Ledger, unreachableContent(feed.ledger.service))),
    );

    expect(await unreachable).toMatchObject({ status: 'succeeded', output: { data: { title: '1' } } });
  });
});

const HeldSchema = Schema.Union([
  factOf(
    'held',
    Schema.Struct({ title: Schema.String, text_sha256: Schema.String, text_bytes: Schema.Number }),
    ActedContextSchema,
    { content: { holds: ['/text_sha256'] } },
  ),
]);

type Held = Decided<typeof HeldSchema.Type>;

const holding: Decider<null, { readonly fact: Held; readonly at: string }, typeof HeldSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ at: when }) => ({ at: when, by: 'acme-admin' }),
  eventSchema: HeldSchema,
};

const decodeHeld = Schema.decodeUnknownSync(
  Schema.Struct({ title: Schema.String, text_sha256: Schema.String, text_bytes: Schema.Number }),
);

const helds: Presenter = {
  streamKind: 'helds',
  publicNames: { held: ['note_held'] },
  present: ({ data }, content) => {
    const { title, text_sha256: sha256, text_bytes: bytes } = decodeHeld(data);
    const text = content(sha256);
    return [
      {
        type: 'note_held',
        summary: 'A note was held.',
        data: { title, text_sha256: sha256, text_bytes: bytes, ...(text === undefined ? {} : { text }) },
      },
    ];
  },
  changes: changingNothing(['held']),
};

const heldHolders = contentHoldersOf([HeldSchema]);

const run = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const ofTheRun: Lineage = { causationId: null, correlationId: run };

function heldIn(feed: ReturnType<typeof harness>, number: number, text: string) {
  const payload = toKeep(text);
  const put = payloadKept(feed.ledger.service.content, { org: 'acme', playbook: 'alpha' }, payload);
  const { sha256, bytes } = payload;
  const fact: Held = { type: 'held', data: { title: `${number}`, text_sha256: sha256, text_bytes: bytes } };
  return feed.run(
    Effect.orDie(put).pipe(
      Effect.andThen(
        feed.ledger.service.execute(`playbook/acme/alpha/helds/${number}`, holding, { fact, at }, ofTheRun),
      ),
      Effect.orDie,
    ),
    at,
  );
}

describe('the tree of a run whose events hold content kept outside them', () => {
  it('reads none of that content, and gives each by its digest and size alone', async () => {
    const feed = harness(alphaKnown, memoryLedger(undefined, [playbookRows], heldHolders));
    await heldIn(feed, 1, 'kept apart');
    const { sha256, bytes } = toKeep('kept apart');
    const tree = await feed.run(
      makeDispatcher([])
        .dispatchToPlaybook(defineGetRunTree([helds]).registration, toAlpha(acmeAdmin, { run_id: run }))
        .pipe(Effect.provideService(Ledger, unreachableContent(feed.ledger.service))),
    );

    expect(tree).toMatchObject({
      status: 'succeeded',
      output: { events: [{ data: { title: '1', text_sha256: sha256, text_bytes: bytes } }] },
    });
    expect(JSON.stringify(tree)).not.toContain('kept apart');
  });
});
