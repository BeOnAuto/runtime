import { Context } from 'effect';

import type { BoundProjectionReader } from '../projections/keyed-projection.ts';
import type { OrgAppendedFactsReader, StreamReader } from './stream-ports.ts';

export class OrgReader extends Context.Service<
  OrgReader,
  StreamReader & OrgAppendedFactsReader & BoundProjectionReader
>()('@on.auto/operations/OrgReader') {}
