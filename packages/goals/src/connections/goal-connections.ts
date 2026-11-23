import { workflowServersIn } from '@on.auto/definitions/goals';
import { askedTogether, PlaybookContext, type PlaybookAddress, type PlaybookReader } from '@on.auto/operations';
import type { GoalGap } from '@on.auto/playbooks';
import { Effect, Exit } from 'effect';

import { connectionMissingGap } from '../gaps/gap-words.ts';
import type { StandingWorkflow } from '../gaps/goal-gaps.ts';
import type { GoalsRead } from '../reads/goals-read-schema.ts';

export type ServerConnected = (address: PlaybookAddress, server: string) => Effect.Effect<boolean>;

export interface ToolNaming {
  readonly named: (
    address: PlaybookAddress,
    references: readonly { readonly server: string; readonly tool: string }[],
  ) => Effect.Effect<void, unknown>;
}

export function serverConnectedThrough({ named }: ToolNaming): ServerConnected {
  return (address, server) =>
    Effect.match(named(address, [{ server, tool: '*' }]), { onFailure: () => false, onSuccess: () => true });
}

export interface GoalConnection {
  readonly server: string;
  readonly name: string;
  readonly connected: boolean;
  readonly workflows: readonly string[];
}

interface GoalConnections {
  readonly of: (goal: string) => readonly GoalConnection[];
  readonly gapsOf: (goal: string) => readonly GoalGap[];
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)].toSorted((left, right) => (left < right ? -1 : 1));
}

function workflowsOf(goal: string, workflows: readonly StandingWorkflow[]): readonly string[] {
  return distinct(
    workflows.filter(({ contributes }) => contributes.some((entry) => entry.goal === goal)).map(({ name }) => name),
  );
}

interface Known {
  readonly servers: ReadonlyMap<string, readonly string[]>;
  readonly connected: ReadonlyMap<string, boolean>;
}

type WorkflowServers = readonly [string, readonly string[]];

function serversIn([, servers]: WorkflowServers): readonly string[] {
  return servers;
}

function workflowIn([workflow]: WorkflowServers): string {
  return workflow;
}

function connectionsOf(goal: string, workflows: readonly StandingWorkflow[], known: Known): readonly GoalConnection[] {
  const own = new Set(workflowsOf(goal, workflows));
  const used: readonly WorkflowServers[] = [...known.servers].filter((pair: WorkflowServers) =>
    own.has(workflowIn(pair)),
  );
  const using = (server: string) =>
    used.filter((pair) => serversIn(pair).includes(server)).map((pair) => workflowIn(pair));
  return distinct(used.flatMap((pair) => serversIn(pair))).map((server) => ({
    server,
    name: server,
    connected: known.connected.get(server) === true,
    workflows: using(server),
  }));
}

function goalConnectionsOf(workflows: readonly StandingWorkflow[], known: Known): GoalConnections {
  const of = (goal: string) => connectionsOf(goal, workflows, known);
  return {
    of,
    gapsOf: (goal) =>
      of(goal)
        .filter(({ connected }) => !connected)
        .map(({ server, workflows: using }) => connectionMissingGap(goal, server, using)),
  };
}

const goalConnectionsIn = Effect.fnUntraced(function* (
  workflows: readonly StandingWorkflow[],
  connected: ServerConnected,
): Effect.fn.Return<GoalConnections | undefined, never, PlaybookReader | PlaybookContext> {
  const contributing = distinct(workflows.filter(({ contributes }) => contributes.length > 0).map(({ name }) => name));
  const servers = yield* workflowServersIn(contributing);
  const address = yield* PlaybookContext;
  const asked = distinct([...servers.values()].flat());
  const answered = yield* Effect.exit(
    Effect.forEach(
      asked,
      (server) => Effect.map(connected(address, server), (is): readonly [string, boolean] => [server, is]),
      { concurrency: 'unbounded' },
    ),
  );
  return Exit.isSuccess(answered)
    ? goalConnectionsOf(workflows, { servers, connected: new Map(answered.value) })
    : undefined;
});

function withTheConnections(read: GoalsRead, connections: GoalConnections | undefined): GoalsRead {
  return connections === undefined
    ? read
    : {
        ...read,
        goals: read.goals.map((goal) => ({
          ...goal,
          gaps: [...goal.gaps, ...connections.gapsOf(goal.id)],
          connections: connections.of(goal.id),
        })),
      };
}

export function readWithTheConnections(
  read: GoalsRead,
  workflows: readonly StandingWorkflow[],
  connected: ServerConnected | undefined,
): Effect.Effect<GoalsRead, never, PlaybookReader | PlaybookContext> {
  return connected === undefined
    ? Effect.succeed(read)
    : Effect.map(askedTogether(goalConnectionsIn(workflows, connected)), (connections) =>
        withTheConnections(read, connections),
      );
}
