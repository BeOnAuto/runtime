import type { HostClock } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { goalNoticesOnNode } from '../../goals/notices/goal-notices.ts';
import type { StartedWork, StartingParts, StartingWork } from '../../workflows/host-dependencies.ts';
import { chatEnvironment, chatServer } from '../interaction-servers/chat-deliveries.ts';
import { interactionServerOn, type InteractionServer } from '../interaction-servers/interaction-server.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { createdWithGoals } from '../settings/goals-kept.ts';
import { assessedIn, factsIn, goalIdentityOf, tellOwner, type NoticedIds } from './notice-facts.ts';

export interface Noticing {
  readonly ledger?: TemporaryLedger;
  readonly clock?: HostClock;
  readonly notices?: boolean;
  readonly goalsPortsOver?: NonNullable<NonNullable<Parameters<typeof interactionServerOn>[1]>['goalsPortsOver']>;
}

export interface NoticeServer {
  readonly server: InteractionServer;
  readonly chat: Awaited<ReturnType<typeof chatServer>>;
  readonly starting: () => Promise<StartingParts>;
  readonly performs: () => number;
  readonly assessed: (told: string, at: number) => Promise<NoticedIds>;
  readonly runs: () => Promise<readonly string[]>;
  readonly goalOf: (name: string) => Promise<string>;
  readonly factsOf: (goal: string, stream: string) => Promise<readonly string[]>;
}

interface Counter {
  readonly counted: () => void;
  readonly count: () => number;
}

function counterOf(): Counter {
  let performs = 0;
  return {
    counted: () => {
      performs += 1;
    },
    count: () => performs,
  };
}

function countedWork(started: StartedWork, { counted }: Counter): StartedWork {
  return {
    ...started,
    dueWork: started.dueWork.map((work) => ({
      ...work,
      due: (now, most, callsOut) =>
        Effect.map(work.due(now, most, callsOut), (items) =>
          items.map((item) => ({
            ...item,
            perform: (at: number) => Effect.andThen(Effect.sync(counted), item.perform(at)),
          })),
        ),
    })),
  };
}

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

function startingWorkOf(
  resolve: (parts: StartingParts) => void,
  counter: Counter,
  { notices = true }: Noticing,
): StartingWork {
  return async (starting) => {
    resolve(starting);
    if (!notices) {
      return { dueWork: [], consumers: [] };
    }
    return countedWork(await goalNoticesOnNode(starting), counter);
  };
}

export async function servingGoalNotices(noticing: Noticing = {}): Promise<NoticeServer> {
  const { ledger, clock, goalsPortsOver } = noticing;
  const chat = await chatServer();
  const parts = Promise.withResolvers<StartingParts>();
  const counter = counterOf();
  const server = await interactionServerOn(chatEnvironment(chat.url), {
    goals: true,
    goalsResults: true,
    goalsMessages: true,
    startingWork: startingWorkOf(parts.resolve, counter, noticing),
    ...(ledger === undefined ? {} : { ledger }),
    ...(clock === undefined ? {} : { clock }),
    ...(goalsPortsOver === undefined ? {} : { goalsPortsOver }),
  });
  const runtime = async () => (await parts.promise).runtime;
  return {
    server,
    chat,
    starting: () => parts.promise,
    performs: counter.count,
    assessed: async (told, at) => assessedIn(await runtime(), told, at),
    goalOf: async (name) => goalIdentityOf(await runtime(), name),
    factsOf: async (goal, stream) => factsIn(await runtime(), goal, stream),
    runs: async () =>
      Schema.decodeUnknownSync(RunsSchema)((await server.call('GET', `${alpha}/runs`)).body).runs.map(
        ({ run_id: id }) => id,
      ),
  };
}

export async function playbookToldBy({ server }: Pick<NoticeServer, 'server'>): Promise<void> {
  await createdWithGoals(server);
  await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner, diagram: 'none' },
  });
}
