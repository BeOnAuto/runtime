import type { ContentStore } from '@on.auto/content';
import {
  defineCommand,
  randomUUIDv7,
  type Caller,
  type Conflict,
  type Decided,
  type Decider,
  type InvalidInput,
  type PlaybookContext,
  type PlaybookReader,
  type PlaybookWriter,
  type Unavailable,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import { decidedIn } from '../read-model-testing/in-the-playbook.ts';
import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import {
  DefinitionEventSchema,
  type DefinitionContent,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { acmeAdmin, recordedAdmin } from './callers.ts';
import { harness, toPlaybook } from './harness.ts';
import { admittingMeter } from './recording-meter.ts';

type Refused = InvalidInput | Conflict | Unavailable;

type Services = PlaybookReader | PlaybookWriter | PlaybookContext | Caller;

const AnswerSchema = Schema.Struct({ answer: Schema.Unknown });

function askingOf(asked: Effect.Effect<unknown, Refused, Services>) {
  return defineCommand('playbook', {
    name: 'ask_the_playbook',
    title: 'Ask the playbook',
    description: 'Answers what a test asks within a playbook.',
    route: { method: 'POST', path: '/asked' },
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    outputSchema: AnswerSchema,
    reasons: ['invalid_input', 'conflict', 'unavailable'],
    handle: () => Effect.map(asked, (answer) => ({ answer: answer ?? null })),
  });
}

const toAlpha = toPlaybook('acme', 'alpha');

const savedAt = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const pagesSavedAsDefinitions = 'playbook/acme/alpha/definitions/page';

interface EarlierPage {
  readonly fact: Decided<RecordedDefinitionEvent>;
  readonly context: RecordedDefinitionEvent['context'];
}

const writtenAsItWas: Decider<undefined, EarlierPage, RecordedDefinitionEvent> = {
  initialState: undefined,
  evolve: () => {},
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: DefinitionEventSchema,
};

function earlierPageFactOf(command: DefinitionCommandData): Decided<RecordedDefinitionEvent> {
  if (command.type === 'create') {
    const { content, created_by: createdBy } = command;
    return { type: 'definition_created', data: { content, created_by: createdBy } };
  }
  if (command.type === 'update') {
    return { type: 'definition_updated', data: { content: command.content } };
  }
  if (command.type === 'pause') {
    return { type: 'definition_paused', data: { paused_by: command.paused_by } };
  }
  return { type: 'definition_retired', data: {} };
}

function pagesAnEarlierReleaseSaved(playbook: ReturnType<typeof harness>) {
  const versions = new Map<string, number>();
  return (command: DefinitionCommandData) => {
    const { name } = command;
    const version = (versions.get(name) ?? 0) + (command.type === 'create' || command.type === 'update' ? 1 : 0);
    versions.set(name, version);
    const context = { ...savedAt, definitionType: 'page', definitionName: name, definitionVersion: version };
    return Effect.runPromise(
      playbook.ledger.service.execute(pagesSavedAsDefinitions, writtenAsItWas, {
        fact: earlierPageFactOf(command),
        context,
      }),
    );
  };
}

export function playbookAsked(store?: ContentStore) {
  const playbook = harness(admittingMeter, store);
  const ask = (asked: Effect.Effect<unknown, Refused, Services>, at?: string) =>
    playbook.call(askingOf(asked), toAlpha(acmeAdmin, {}), at);
  const record = (type: string, command: DefinitionCommandData) =>
    Effect.runPromise(
      decidedIn(playbook.ledger.service, { org: 'acme', playbook: 'alpha' }, type, { ...command, ...savedAt }),
    );
  const created = (type: string, name: string, source: string, more: Omit<DefinitionContent, 'source'> = {}) =>
    record(type, {
      type: 'create',
      name,
      content: { source, ...more },
      created_by: recordedAdmin,
      definition_id: randomUUIDv7(),
    });
  const recordedAsAPage = pagesAnEarlierReleaseSaved(playbook);
  const savedAsAPage = (name: string, source: string, more: Omit<DefinitionContent, 'source'> = {}) =>
    recordedAsAPage({
      type: 'create',
      name,
      content: { source, ...more },
      created_by: recordedAdmin,
      definition_id: '',
    });
  return { playbook, ask, record, created, recordedAsAPage, savedAsAPage };
}
