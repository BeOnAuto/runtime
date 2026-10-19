import type { Timing } from '@on.auto/tool-servers';
import type { HostClock } from '@on.auto/workflow-host';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';

export interface ServedParts {
  readonly programPoolOf?: ProgramPoolOf;
  readonly clock?: HostClock;
  readonly toolTiming?: Timing;
}
