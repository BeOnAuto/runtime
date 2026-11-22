import type { AppRuntime } from '@on.auto/api';
import type { PlaybookOperation, Capability, RecordWork } from '@on.auto/definitions';
import { requestsSetAside, thingsAskedAbout, type AskedAbout } from '@on.auto/goals';
import {
  conversationsDue,
  answerInteraction,
  listInteractions,
  listInteractionsAbout,
  makeInteractionFunctionAdapter,
  openRequestsName,
  replyDelivery,
  requestsAskingAbout,
  requestsDue,
  type ReplyDelivery,
  type RequestsDue,
} from '@on.auto/interaction';
import type { DispatcherServices } from '@on.auto/operations';
import { conversationsOf } from '@on.auto/providers';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

interface RecordedInteraction {
  readonly dueWork: readonly RequestsDue[];
  readonly delivered: ReplyDelivery;
}

export interface ServedInteraction {
  readonly capability: Capability;
  readonly operations: readonly PlaybookOperation[];
  readonly recordedBy: (record: RecordWork) => RecordedInteraction;
  readonly askedAbout: AskedAbout;
}

const askedAboutServed: AskedAbout = requestsAskingAbout(thingsAskedAbout);

export function interactionServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { interaction, providers }: Pick<Settings, 'interaction' | 'providers'>,
  tools: Pick<
    ToolAccess,
    | 'named'
    | 'configured'
    | 'assets'
    | 'preparedCall'
    | 'callOnce'
    | 'listServers'
    | 'takesConnections'
    | 'mostRequestBytes'
    | 'mostRequestBytesTo'
  >,
  results = false,
): ServedInteraction {
  const ledger = runtimeLedger(runtime);
  return {
    capability: makeInteractionFunctionAdapter({
      tools,
      openRequests: (playbook) =>
        ledger.countProjectedRows(openRequestsName, playbook, [{ column: 'open', equals: true }]),
      mostOpenRequests: interaction.mostOpenRequests,
      conversationsOf: (provider) => Effect.succeed(conversationsOf(providers, provider)),
    }),
    operations: [
      answerInteraction,
      results ? listInteractionsAbout({ about: thingsAskedAbout, setAside: requestsSetAside }) : listInteractions,
    ],
    recordedBy: (record) => ({
      dueWork: [requestsDue({ ledger, tools, record }), conversationsDue({ ledger, tools, record })],
      delivered: replyDelivery({ ledger, tools, record }),
    }),
    askedAbout: askedAboutServed,
  };
}
