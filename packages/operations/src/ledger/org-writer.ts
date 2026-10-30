import { Context } from 'effect';

import type { StreamWriter } from './stream-ports.ts';

export class OrgWriter extends Context.Service<OrgWriter, StreamWriter>()('@on.auto/operations/OrgWriter') {}
