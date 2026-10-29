import { Context } from 'effect';

import type { OrgAppendedFactsReader, StreamReader } from './stream-ports.ts';

export class OrgReader extends Context.Service<OrgReader, StreamReader & OrgAppendedFactsReader>()(
  '@on.auto/operations/OrgReader',
) {}
