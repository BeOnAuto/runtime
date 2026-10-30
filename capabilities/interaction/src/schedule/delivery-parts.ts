import type { RecordWork } from '@on.auto/definitions';
import type { Lineage } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import type { RequestLedger } from './request-ledger.ts';

export interface DeliveryParts {
  readonly ledger: RequestLedger;
  readonly tools: Pick<ToolAccess, 'preparedCall'>;
  readonly record: RecordWork;
}

export interface DueRequest {
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly lineage: Lineage;
}
