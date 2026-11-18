import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookOfStreamPrefix, streamPrefixOfPlaybook, streamPrefixOfOrg } from '../index.ts';
import { acmeAdmin, acmeAlphaReader, globexAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { addNote, listNotes, readNoteHistory } from '../testing/notes.ts';
import { getPlaybookLabel, labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';
import { putOnShelf, readShelf } from '../testing/shelves.ts';

const anyWords: unknown = expect.any(String);

describe('the ports bound to a call', () => {
  it('prefix every stream with the org or playbook of the call, so each reads and writes only its own', async () => {
    const { dispatcher: d, ledger, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toPlaybook('acme', 'alpha');
    const toGamma = toPlaybook('globex', 'gamma');

    await run(d.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(d.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    await run(d.dispatchToOrg(labelPlaybook.registration, toAcme(acmeAdmin, { playbook: 'alpha', label: 'Sales' })));
    await run(d.dispatchToOrg(labelPlaybook.registration, toAcme(acmeAdmin, { playbook: 'beta', label: 'Support' })));

    expect(ledger.streamNames()).toEqual([
      'playbook/acme/alpha/notes',
      'playbook/globex/gamma/notes',
      'org/acme/playbook-labels',
    ]);
    expect(await run(d.dispatchToPlaybook(listNotes.registration, toAlpha(acmeAlphaReader)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'anvil', text: 'heavy' }] },
    });
    expect(await run(d.dispatchToPlaybook(listNotes.registration, toGamma(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'gear', text: 'round' }] },
    });
    expect(
      await run(d.dispatchToOrg(getPlaybookLabel.registration, toAcme(acmeAlphaReader, { playbook: 'alpha' }))),
    ).toEqual({
      status: 'succeeded',
      output: { playbook: 'alpha', label: 'Sales' },
    });
    expect(await run(d.dispatchToOrg(listPlaybookLabels.registration, toOrg('globex')(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { labels: [] },
    });
  });

  it('share the prefix of an org with code that holds the unbound ledger', async () => {
    const { dispatcher: d, ledger, run } = harness();

    await run(
      d.dispatchToOrg(labelPlaybook.registration, toOrg('acme')(acmeAdmin, { playbook: 'alpha', label: 'Sales' })),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfOrg({ org: 'acme' })}playbook-labels`]);
  });
});

describe('the prefix of a playbook', () => {
  it('is shared with code that holds the unbound ledger', async () => {
    const { dispatcher: d, ledger, run } = harness();

    await run(
      d.dispatchToPlaybook(addNote.registration, toPlaybook('acme', 'alpha')(acmeAdmin, { name: 'anvil', text: 'x' })),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}notes`]);
  });

  it('names its playbook again, and a prefix that is not a playbook names none', () => {
    const alpha = { org: 'acme', playbook: 'alpha' };

    expect(
      [
        streamPrefixOfPlaybook(alpha),
        streamPrefixOfOrg(alpha),
        'org/acme/alpha/',
        'playbook/acme/alpha',
        'playbook/acme/alpha/runs/',
        'playbook//alpha/',
      ].map((prefix) => playbookOfStreamPrefix(prefix)),
    ).toEqual([Option.some(alpha), Option.none(), Option.none(), Option.none(), Option.none(), Option.none()]);
  });
});

const malformedStreams = [
  '../../beta/definitions',
  '',
  'red/',
  'red//blue',
  'a\u0000b',
  'r'.repeat(65),
  Array.from({ length: 5 }, () => 'r'.repeat(60)).join('/'),
];

describe('a stream name a handler gives a bound port', () => {
  it('is one or more segments of letters, digits, _ and -, compared case-sensitively', async () => {
    const { dispatcher: d, ledger, run } = harness();
    const toAlpha = toPlaybook('acme', 'alpha');

    await run(d.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'anvil' })));
    await run(
      d.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'Red_1-x/top', item: 'bolt' })),
    );

    expect(ledger.streamNames()).toEqual([
      'playbook/acme/alpha/shelves/red',
      'playbook/acme/alpha/shelves/Red_1-x/top',
    ]);
    expect(await run(d.dispatchToPlaybook(readShelf.registration, toAlpha(acmeAdmin, { shelf: 'RED' })))).toEqual({
      status: 'succeeded',
      output: { items: [] },
    });
  });

  it.each(malformedStreams)('fails the call when it names the stream shelves/%j', async (shelf) => {
    const { dispatcher: d, ledger, reported, run } = harness();
    const toAlpha = toPlaybook('acme', 'alpha');

    const writing = await run(d.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf, item: 'x' })));
    const reading = await run(d.dispatchToPlaybook(readShelf.registration, toAlpha(acmeAdmin, { shelf })));

    expect([writing.status, reading.status, ledger.streamNames()]).toEqual(['failed', 'failed', []]);
    expect(reported().map(({ original }) => original)).toEqual([
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
    ]);
  });
});

const toAlpha = toPlaybook('acme', 'alpha');

const toGamma = toPlaybook('globex', 'gamma');

describe('the read of what a playbook recorded, bound to a call', () => {
  it('reads only the playbook of the call, and names its streams relative to the playbook', async () => {
    const { dispatcher: d, run } = harness();
    await run(d.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(d.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    await run(d.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'bolt' })));

    const whole = await run(d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10 })));
    const first = await run(d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 1 })));

    expect(whole).toMatchObject({
      status: 'succeeded',
      output: { streams: ['notes', 'shelves/red'], next_cursor: null },
    });
    expect(first).toMatchObject({ status: 'succeeded', output: { streams: ['notes'] } });
    expect(first).not.toMatchObject({ output: { next_cursor: null } });
  });

  it('reads the streams of one run', async () => {
    const { dispatcher: d, run } = harness();
    await run(d.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));

    expect(
      await run(d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, run: 'run-1' }))),
    ).toEqual({ status: 'succeeded', output: { streams: [], ids: [], next_cursor: null } });
  });

  it('reads what one run and the runs it caused recorded, by their correlation', async () => {
    const { dispatcher: d, run } = harness();
    await run(d.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));

    expect(
      await run(
        d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, correlation: 'run-1' })),
      ),
    ).toEqual({ status: 'succeeded', output: { streams: [], ids: [], next_cursor: null } });
  });
});

describe('a cursor given to the read bound to a call', () => {
  it('is refused as invalid input at /cursor, saying whether it is malformed or of another playbook', async () => {
    const { dispatcher: d, ledger, run } = harness();
    await run(d.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(
        { org: 'globex', playbook: 'gamma' },
        { kind: 'everything' },
        { order: 'asc', limit: 1 },
      ),
    );
    const reading = (cursor: string) =>
      run(d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, cursor })));

    const refusals = await Promise.all(
      [...records.map(({ cursor }) => cursor), 'not-a-cursor'].map((cursor) => reading(cursor)),
    );

    expect(refusals).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor was not given by a read of this playbook',
        issues: [
          {
            detail: anyWords,
            pointer: '/cursor',
          },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor is malformed',
        issues: [{ detail: anyWords, pointer: '/cursor' }],
      },
    ]);
  });
});

describe('a page the read bound to a call cannot hold', () => {
  it.each([
    [{ limit: 0 }, 'RangeError: A page holds 1 to 100 records, not 0'],
    [{ limit: 101 }, 'RangeError: A page holds 1 to 100 records, not 101'],
    [{ limit: 10, since: 'yesterday' }, 'RangeError: The time "yesterday" a page starts from is not a time'],
    [{ limit: 10, run: 'a/../b' }, 'Error: The stream name "runs/a/../b" is malformed'],
    [{ limit: 10, correlation: 'a/../b' }, 'Error: The stream name "runs/a/../b" is malformed'],
  ] as const)('fails the call, %j', async (input, defect) => {
    const { dispatcher: d, reported, run } = harness();

    expect(await run(d.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, input)))).toMatchObject({
      status: 'failed',
    });
    expect(reported().map(({ original }) => String(original))).toEqual([defect]);
  });
});
