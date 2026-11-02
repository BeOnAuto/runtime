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

import { LicenseKeyEventSchema } from '../licensing/kept-license-key.ts';
import { OwnKeyEventSchema } from '../secrets/own-keys.ts';
import { orgFactSchemas } from './org-facts.ts';

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
  OwnKeyEventSchema,
  LicenseKeyEventSchema,
];

export function factSchemasKnownWith(declared: readonly DeclaredFact[]): readonly FactSchemaRead[] {
  return [...knownFactSchemas, ...declared.map(({ schema }) => schema)];
}
