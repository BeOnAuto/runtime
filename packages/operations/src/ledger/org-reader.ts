import { Context } from 'effect';

import type { OrgProjectionReader } from '../projections/keyed-projection.ts';
import type { OrgAppendedFactsReader, StreamReader } from './stream-ports.ts';

export class OrgReader extends Context.Service<
  OrgReader,
  StreamReader & OrgAppendedFactsReader & OrgProjectionReader
>()('@on.auto/operations/OrgReader') {}
