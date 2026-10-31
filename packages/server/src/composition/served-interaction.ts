import type { AppRuntime } from '@on.auto/api';
import type { PlaybookOperation, Capability, RecordWork } from '@on.auto/definitions';
import {
  conversationsDue,
  answerInteraction,
  listInteractions,
  makeInteractionFunctionAdapter,
  openRequestsName,
  requestsDue,
  type RequestsDue,
} from '@on.auto/interaction';
import type { DispatcherServices } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ServedInteraction {
  readonly capability: Capability;
  readonly operations: readonly PlaybookOperation[];
  readonly dueWorkOf: (record: RecordWork) => readonly RequestsDue[];
}

export function interactionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { interaction }: Pick<Settings, 'interaction'>,
  tools: Pick<ToolAccess, 'named' | 'configured' | 'preparedCall' | 'callOnce' | 'listServers' | 'takesConnections'>,
): ServedInteraction {
  const ledger = runtimeLedger(runtime);
  return {
    capability: makeInteractionFunctionAdapter({
      tools,
      openRequests: (playbook) =>
        ledger.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
      mostOpenRequests: interaction.mostOpenRequests,
    }),
    operations: [answerInteraction, listInteractions],
    dueWorkOf: (record) => [requestsDue({ ledger, tools, record }), conversationsDue({ ledger, tools, record })],
  };
}
