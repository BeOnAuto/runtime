import type { ProvidedOnceServed } from '../capability-registry/served-ports.ts';
import type { GoalsPortsOver } from '../goals/goals-engine-lists.ts';
import type { SocketsServing } from '../sockets/sockets-of-the-server.ts';
import { workerPool, type ProgramPoolOf, type ServedComputation } from './served-computation.ts';
import type { GenerationWiring } from './served-generation.ts';
import { projectionWiring, type ProjectionWiring } from './served-projections.ts';
import type { ToolAccessWiring } from './served-tool-access.ts';
import type { ToolUsersWiring } from './served-tools.ts';

export interface FunctionWiring extends ToolAccessWiring {
  readonly programPoolOf: ProgramPoolOf;
  readonly projections: ProjectionWiring;
}

export interface ServedWiring extends Omit<FunctionWiring, 'programPoolOf'>, ToolUsersWiring {
  readonly computation: ServedComputation;
  readonly prediction: ProvidedOnceServed;
  readonly generation: GenerationWiring;
  readonly goals: boolean;
  readonly results: boolean;
  readonly messages: boolean;
  readonly goalsPortsOver?: GoalsPortsOver | undefined;
  readonly opens: SocketsServing['opens'];
}

export function functionWiringOf(
  programPoolOf: ProgramPoolOf = workerPool,
  toolTiming?: FunctionWiring['toolTiming'],
  now?: FunctionWiring['now'],
): FunctionWiring {
  return {
    programPoolOf,
    projections: projectionWiring(),
    ...(toolTiming === undefined ? {} : { toolTiming }),
    ...(now === undefined ? {} : { now }),
  };
}
