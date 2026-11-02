import { CommentEventSchema } from '@on.auto/activity';
import { ConnectionEventSchema, RegistrationEventSchema } from '@on.auto/connections';
import {
  DefinitionEventSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  RunEventSchema,
  type DeclaredFact,
} from '@on.auto/definitions';
import { InteractionRunFactSchema } from '@on.auto/interaction';
import type { FactSchemaRead } from '@on.auto/ledger';
import { MeterEventSchema } from '@on.auto/meter';
import { ConversationCallEventSchema, HandCallEventSchema } from '@on.auto/tool-servers';
import { RunLogRecordSchema } from '@on.auto/workflow-engine';

import { orgFactSchemas } from './org-facts.ts';
import { serverFactSchemas } from './server-facts.ts';

export const knownFactSchemas = [
  ...orgFactSchemas,
  DefinitionEventSchema,
  RunEventSchema,
  InteractionRunFactSchema,
  RunLogRecordSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  ConnectionEventSchema,
  RegistrationEventSchema,
  HandCallEventSchema,
  ConversationCallEventSchema,
  MeterEventSchema,
  ...serverFactSchemas,
  CommentEventSchema,
];

export function factSchemasKnownWith(declared: readonly DeclaredFact[]): readonly FactSchemaRead[] {
  return [...knownFactSchemas, ...declared.map(({ schema }) => schema)];
}
