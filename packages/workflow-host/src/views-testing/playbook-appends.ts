import { randomUUID } from 'node:crypto';

import type { AppendSignal, EncodedEvent, LedgerStreams } from '@on.auto/ledger';
import { streamPrefixOfPlaybook, type Context } from '@on.auto/operations';
import type { Schema } from 'effect';

import type { ViewDetails } from '../views/view-details.ts';
import { alpha, alphaKey, viewedType, type Playbook } from './view-documents.ts';

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
  readonly savedPage: (name: string, details: Schema.JsonObject, source?: string) => Promise<void>;
  readonly retiredPage: (name: string) => Promise<void>;
  readonly pageSaved: (subject: string, version: number, details: Schema.JsonObject) => Promise<void>;
  readonly pageRemoved: (subject: string, version: number) => Promise<void>;
  readonly subjectSaved: (subject: string, version: number) => Promise<void>;
  readonly subjectRetired: (subject: string) => Promise<void>;
  readonly subjectPaused: (subject: string) => Promise<void>;
  readonly playbookPageSaved: (details: Schema.JsonObject) => Promise<void>;
  readonly playbookPageRemoved: () => Promise<void>;
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
        { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
        { type: 'run_succeeded', data: { output, record: {} } },
      ],
      { ...ranContext(subject, at), runId: id },
    );
    return id;
  };
}

type Saved = (name: string, details?: Schema.JsonObject, playbook?: Playbook, source?: string) => Promise<void>;

function savedBy(append: Append, definitions: Map<string, number>, definitionType: string): Saved {
  return async (name, details, playbook = alpha, source?: string) => {
    const key = `${streamPrefixOfPlaybook(playbook)}${definitionType}/${name}`;
    const version = (definitions.get(key) ?? 0) + 1;
    definitions.set(key, version);
    const content = {
      source: source ?? `the ${name} document, version ${version}`,
      ...(details === undefined ? {} : { details }),
    };
    const saving =
      version === 1
        ? { type: 'definition_created', data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } } }
        : { type: 'definition_updated', data: { content } };
    await append(`${streamPrefixOfPlaybook(playbook)}definitions/${definitionType}`, [saving], {
      by: 'acme-admin',
      at: savedAt,
      definitionType,
      definitionName: name,
      definitionVersion: version,
    });
  };
}

function retiredBy(append: Append, definitions: Map<string, number>, definitionType: string) {
  return async (name: string) => {
    await append(
      `${streamPrefixOfPlaybook(alpha)}definitions/${definitionType}`,
      [{ type: 'definition_retired', data: {} }],
      {
        by: 'acme-admin',
        at: savedAt,
        definitionType,
        definitionName: name,
        definitionVersion: Number(definitions.get(`${streamPrefixOfPlaybook(alpha)}${definitionType}/${name}`)),
      },
    );
  };
}

function inTurn(): () => string {
  let saves = 0;
  return () => {
    saves += 1;
    return new Date(Date.parse(savedAt) + saves * 1000).toISOString();
  };
}

function onTheSubject(append: Append, at: string, subject: string, version = 1) {
  const [type = '', name = ''] = subject.split('/');
  return (events: readonly EncodedEvent[]) =>
    append(`${alphaKey}definitions/${type}`, events, {
      by: 'acme-admin',
      at,
      definitionType: type,
      definitionName: name,
      definitionVersion: version,
    });
}

function savedWith(version: number, page: Schema.Json | undefined): EncodedEvent {
  const content = { source: `version ${version}`, ...(page === undefined ? {} : { page }) };
  return version === 1
    ? { type: 'definition_created', data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } } }
    : { type: 'definition_updated', data: { content } };
}

function pageAppendsOf(append: Append) {
  const next = inTurn();
  const onThePlaybook = (page: Schema.Json) =>
    append(`${alphaKey}definitions/playbook`, [{ type: 'playbook_page_saved', data: { page } }], {
      by: 'acme-admin',
      at: next(),
    });
  const saving = (subject: string, version: number, page?: Schema.Json) =>
    onTheSubject(append, next(), subject, version)([savedWith(version, page)]);
  return {
    pageSaved: (subject: string, version: number, details: Schema.JsonObject) => saving(subject, version, { details }),
    pageRemoved: (subject: string, version: number) => saving(subject, version, null),
    subjectSaved: (subject: string, version: number) => saving(subject, version),
    subjectRetired: (subject: string) =>
      onTheSubject(append, next(), subject)([{ type: 'definition_retired', data: {} }]),
    subjectPaused: (subject: string) =>
      onTheSubject(
        append,
        next(),
        subject,
      )([{ type: 'definition_paused', data: { paused_by: { id: 'acme-admin', name: 'acme-admin' } } }]),
    playbookPageSaved: (details: Schema.JsonObject) => onThePlaybook({ source: 'runs: |\n  Posts', details }),
    playbookPageRemoved: () => onThePlaybook(null),
  };
}

export function playbookAppends(store: LedgerStreams, appends: AppendSignal): PlaybookAppends {
  const append = appendOn(store, appends);
  const ran = ranBy(append);
  const definitions = new Map<string, number>();
  return {
    append,
    saved: savedBy(append, definitions, viewedType),
    retired: retiredBy(append, definitions, viewedType),
    savedPage: (name, details, source) => savedBy(append, definitions, 'page')(name, details, alpha, source),
    ...pageAppendsOf(append),
    retiredPage: retiredBy(append, definitions, 'page'),
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
