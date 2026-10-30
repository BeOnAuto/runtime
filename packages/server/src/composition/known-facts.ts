import { ConnectionEventSchema, RegistrationEventSchema } from '@on.auto/connections';
import {
  DefinitionEventSchema,
  EventPublishedSchema,
  ReactionRefusedSchema,
  RunEventSchema,
} from '@on.auto/definitions';
import { InteractionRunFactSchema } from '@on.auto/interaction';
import { MeterEventSchema } from '@on.auto/meter';
import { PlaybookEventSchema } from '@on.auto/playbooks';
import { ConversationCallEventSchema, HandCallEventSchema } from '@on.auto/tool-servers';
import { RunLogRecordSchema } from '@on.auto/workflow-engine';

import { LicenseKeyEventSchema } from '../licensing/kept-license-key.ts';
import { OwnKeyEventSchema } from '../secrets/own-keys.ts';

export const knownFactSchemas = [
  PlaybookEventSchema,
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
