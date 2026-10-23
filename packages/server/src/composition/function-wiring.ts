import { workerPool, type ProgramPoolOf } from './served-computation.ts';
import { projectionWiring, type ProjectionWiring } from './served-projections.ts';
import type { ToolAccessWiring } from './served-tool-access.ts';

export interface FunctionWiring extends ToolAccessWiring {
  readonly programPoolOf: ProgramPoolOf;
  readonly projections: ProjectionWiring;
}

export function functionWiringOf(
  programPoolOf: ProgramPoolOf = workerPool,
  toolTiming?: FunctionWiring['toolTiming'],
): FunctionWiring {
  return {
    programPoolOf,
    projections: projectionWiring(),
    ...(toolTiming === undefined ? {} : { toolTiming }),
  };
}
