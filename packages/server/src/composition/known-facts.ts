import { ConnectionDocumentEventSchema, ConnectionEventSchema, RegistrationEventSchema } from '@on.auto/connections';
import {
  DefinitionEventSchema,
  EventPublishedSchema,
  PageEventSchema,
  ReactionRefusedSchema,
  RunEventSchema,
  type DeclaredFact,
} from '@on.auto/definitions';
import { AssetEventSchema } from '@on.auto/generation';
import { InteractionRunFactSchema } from '@on.auto/interaction';
import { ConversationCallEventSchema, HandCallEventSchema } from '@on.auto/tool-servers';
import { RunLogRecordSchema } from '@on.auto/workflow-engine';

import { orgFactSchemas } from './org-facts.ts';
import { serverFactSchemas } from './server-facts.ts';

export const knownFactSchemas = [
  ...orgFactSchemas,
  DefinitionEventSchema,
  PageEventSchema,
  RunEventSchema,
  InteractionRunFactSchema,
  RunLogRecordSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  ConnectionEventSchema,
  ConnectionDocumentEventSchema,
  RegistrationEventSchema,
  HandCallEventSchema,
  ConversationCallEventSchema,
  AssetEventSchema,
  ...serverFactSchemas,
];

export function factSchemasKnownWith(declared: readonly DeclaredFact[]) {
  return [...knownFactSchemas, ...declared.map(({ schema }) => schema)];
}
