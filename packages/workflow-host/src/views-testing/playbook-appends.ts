import { randomUUID } from 'node:crypto';

import type { AppendSignal, EncodedEvent, LedgerStreams } from '@on.auto/ledger';
import { streamPrefixOfPlaybook, type Context } from '@on.auto/operations';
import type { Schema } from 'effect';

import type { ViewDetails } from '../views/view-details.ts';
import { alpha, type Playbook } from './view-documents.ts';

interface RunOf {
  readonly at?: string;
  readonly playbook?: Playbook;
}

type Append = (stream: string, events: readonly EncodedEvent[], context?: Context) => Promise<void>;

type Ran = (subject: string, output: Schema.Json, more?: RunOf) => Promise<string>;

export interface PlaybookAppends {
  readonly append: Append;
  readonly saved: (name: string, details?: ViewDetails, playbook?: Playbook) => Promise<void>;
  readonly retired: (name: string) => Promise<void>;
  readonly ran: Ran;
  readonly ranEach: (subject: string, outputs: readonly Schema.Json[]) => Promise<unknown>;
  readonly ranInOneStream: (subject: string, outputs: readonly Schema.Json[]) => Promise<void>;
  readonly published: (event: Schema.JsonObject, playbook?: Playbook) => Promise<void>;
}

const savedAt = '2026-10-06T09:00:00.000Z';

const ranAt = '2026-10-06T10:00:00.000Z';

const byAdmin: Context = { by: 'acme-admin', at: ranAt };

function ranContext(subject: string, at: string): Context {
  const [type = '', name = ''] = subject.split('/');
  return { by: 'acme-admin', at, definitionType: type, definitionName: name, definitionVersion: 1 };
}

function appendOn(store: LedgerStreams, appends: AppendSignal): Append {
  const streams = new Map<string, number>();
  return async (stream, events, context = byAdmin) => {
    const version = streams.get(stream) ?? 0;
    await store.append(stream, events, { expectedVersion: version, context });
    streams.set(stream, version + events.length);
    appends.raise(stream);
  };
}

function ranBy(append: Append): Ran {
  return async (subject, output, { at = ranAt, playbook = alpha } = {}) => {
    const id = randomUUID();
    await append(
      `${streamPrefixOfPlaybook(playbook)}runs/${id}`,
      [
        { type: 'run_started', data: { input: {} } },
        { type: 'run_succeeded', data: { output, record: {} } },
      ],
      { ...ranContext(subject, at), runId: id },
    );
    return id;
  };
}

function savedBy(append: Append, definitions: Map<string, number>): PlaybookAppends['saved'] {
  return async (name, details, playbook = alpha) => {
    const key = `${streamPrefixOfPlaybook(playbook)}${name}`;
    const version = (definitions.get(key) ?? 0) + 1;
    definitions.set(key, version);
    const type = version === 1 ? 'definition_created' : 'definition_updated';
    const content = {
      source: `the ${name} document, version ${version}`,
      ...(details === undefined ? {} : { details }),
    };
    await append(`${streamPrefixOfPlaybook(playbook)}definitions/recall`, [{ type, data: { content } }], {
      by: 'acme-admin',
      at: savedAt,
      definitionType: 'recall',
      definitionName: name,
      definitionVersion: version,
    });
  };
}

export function playbookAppends(store: LedgerStreams, appends: AppendSignal): PlaybookAppends {
  const append = appendOn(store, appends);
  const ran = ranBy(append);
  const definitions = new Map<string, number>();
  return {
    append,
    saved: savedBy(append, definitions),
    retired: async (name) => {
      await append(`${streamPrefixOfPlaybook(alpha)}definitions/recall`, [{ type: 'definition_retired', data: {} }], {
        by: 'acme-admin',
        at: savedAt,
        definitionType: 'recall',
        definitionName: name,
        definitionVersion: Number(definitions.get(`${streamPrefixOfPlaybook(alpha)}${name}`)),
      });
    },
    ran,
    ranInOneStream: async (subject, outputs) => {
      const id = randomUUID();
      await append(
        `${streamPrefixOfPlaybook(alpha)}runs/${id}`,
        outputs.map((output) => ({ type: 'run_succeeded', data: { output, record: {} } })),
        { ...ranContext(subject, ranAt), runId: id },
      );
    },
    ranEach: (subject, outputs) =>
      outputs.reduce<Promise<unknown>>((before, output) => before.then(() => ran(subject, output)), Promise.resolve()),
    published: async (event, playbook = alpha) => {
      await append(`${streamPrefixOfPlaybook(playbook)}events/${randomUUID()}`, [
        { type: 'event_published', data: { event, filled: [] } },
      ]);
    },
  };
}
