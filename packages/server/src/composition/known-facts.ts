import { ConnectionEventSchema, RegistrationEventSchema } from '@on.auto/connections';
import {
  DefinitionEventSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  RunEventSchema,
  type DeclaredFact,
} from '@on.auto/definitions';
import { AssetEventSchema } from '@on.auto/generation';
import { InteractionRunFactSchema } from '@on.auto/interaction';
import { MemoryFactSchema } from '@on.auto/memory';
import { ConversationCallEventSchema, HandCallEventSchema } from '@on.auto/tool-servers';
import { RunLogRecordSchema } from '@on.auto/workflow-engine';

import { orgFactSchemas } from './org-facts.ts';
import { serverFactSchemas } from './server-facts.ts';

export const knownFactSchemas = [
  ...orgFactSchemas,
  DefinitionEventSchema,
  RunEventSchema,
  InteractionRunFactSchema,
  MemoryFactSchema,
  RunLogRecordSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  ConnectionEventSchema,
  RegistrationEventSchema,
  HandCallEventSchema,
  ConversationCallEventSchema,
  AssetEventSchema,
  ...serverFactSchemas,
];

export function factSchemasKnownWith(declared: readonly DeclaredFact[]) {
  return [...knownFactSchemas, ...declared.map(({ schema }) => schema)];
}
