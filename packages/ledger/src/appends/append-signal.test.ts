import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StreamStore } from '../event-store.ts';
import type { MultiStreamAppends } from '../multi-stream/multi-stream-appends.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { happenings, noted, stamped } from '../testing/happenings.ts';
import { appendSignal, playbookKeyOfStream, signalledOn } from './append-signal.ts';

function storeAnswering(appended: () => Promise<void>): StreamStore & MultiStreamAppends {
  return {
    mostEventsInOneAppend: 8,
    read: () => Promise.resolve({ version: 0, messages: [] }),
    readPage: () => Promise.resolve({ messages: [], through: 0, more: false }),
    append: appended,
    multiStreamAppend: appended,
    migrate: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function failingStore(): StreamStore & MultiStreamAppends {
  return storeAnswering(() => Promise.reject(new Error('The database is gone')));
}

const aNote = [{ type: 'noted', data: {} }];

describe('the signal of an append to a playbook', () => {
  it('is raised with the playbook once the append is recorded, and not for a stream of no playbook', async () => {
    const appends = appendSignal();
    const runtime = ManagedRuntime.make(ledgerLayer({ fileName: ':memory:', appends }));
    const ledger = await runtime.runPromise(Ledger);
    const heard: string[] = [];
    const versionsSeen: Promise<number>[] = [];
    appends.listen((playbookKey) => {
      heard.push(playbookKey);
      versionsSeen.push(
        Effect.runPromise(Effect.map(ledger.load('playbook/acme/alpha/notes', happenings), ({ version }) => version)),
      );
    });

    await Effect.runPromise(ledger.execute('playbook/acme/alpha/notes', happenings, [noted('noted', 1)]));
    await Effect.runPromise(ledger.execute('org/acme/playbooks', happenings, [noted('noted', 2)]));
    const seen = await Promise.all(versionsSeen);
    await runtime.dispose();

    expect([heard, seen]).toEqual([['playbook/acme/alpha/'], [1]]);
  });

  it('is not raised for an append that failed, and no longer reaches a listener that stopped listening', async () => {
    const appends = appendSignal();
    const heard: string[] = [];
    const stop = appends.listen((playbookKey) => {
      heard.push(playbookKey);
    });

    const failed = await signalledOn(failingStore(), appends)
      .append('playbook/acme/alpha/notes', [], { expectedVersion: 0, context: stamped })
      .catch(String);
    appends.raise('playbook/acme/alpha/notes');
    stop();
    appends.raise('playbook/acme/beta/notes');

    expect([failed, heard]).toEqual(['Error: The database is gone', ['playbook/acme/alpha/']]);
  });

  it('names a playbook by its stream through the third slash, and leaves a store without a signal as it is', () => {
    const store = failingStore();

    expect([
      playbookKeyOfStream('playbook/acme/alpha/runs/run-1'),
      playbookKeyOfStream('playbook/acme/alpha'),
      signalledOn(store) === store,
    ]).toEqual(['playbook/acme/alpha/', undefined, true]);
  });
});

describe('the signal of a multi-stream append to playbooks', () => {
  it('is raised with each playbook a multi-stream append recorded to, and not for one that failed', async () => {
    const appends = appendSignal();
    const heard: string[] = [];
    appends.listen((playbookKey) => {
      heard.push(playbookKey);
    });
    const place = { expectedVersion: 0, context: stamped };
    const requests = [
      { stream: 'playbook/acme/alpha/notes', events: aNote, place },
      { stream: 'org/acme/playbooks', events: aNote, place },
      { stream: 'playbook/acme/beta/notes', events: aNote, place },
    ];

    await signalledOn(
      storeAnswering(() => Promise.resolve()),
      appends,
    ).multiStreamAppend(requests);
    const failed = await signalledOn(failingStore(), appends).multiStreamAppend(requests).catch(String);

    expect([failed, heard]).toEqual(['Error: The database is gone', ['playbook/acme/alpha/', 'playbook/acme/beta/']]);
  });
});
