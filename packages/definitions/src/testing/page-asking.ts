import type { ContentStore } from '@on.auto/content';
import {
  defineCommand,
  randomUUIDv7,
  type Caller,
  type Conflict,
  type InvalidInput,
  type PlaybookContext,
  type PlaybookReader,
  type PlaybookWriter,
  type Unavailable,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
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

export function playbookAsked(store?: ContentStore) {
  const playbook = harness(admittingMeter, store);
  const ask = (asked: Effect.Effect<unknown, Refused, Services>, at?: string) =>
    playbook.call(askingOf(asked), toAlpha(acmeAdmin, {}), at);
  const record = (type: string, command: DefinitionCommandData) =>
    Effect.runPromise(
      playbook.ledger.service.execute(
        `playbook/acme/alpha/${definitionTypeStreamOf(type)}`,
        definitionsDecider(type, { org: 'acme', playbook: 'alpha' }),
        {
          ...command,
          ...savedAt,
        },
      ),
    );
  const created = (type: string, name: string, source: string, more: Omit<DefinitionContent, 'source'> = {}) =>
    record(type, {
      type: 'create',
      name,
      content: { source, ...more },
      created_by: recordedAdmin,
      definition_id: randomUUIDv7(),
    });
  return { playbook, ask, record, created };
}
