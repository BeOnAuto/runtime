import { IncidentReporter } from '@on.auto/operations';
import { PayloadsShared, sharedPayloadsWithin } from '@on.auto/operations/payloads';
import { hostPayloadCacheBytes } from '@on.auto/workflow-host';
import { Layer } from 'effect';

import { logIncident } from '../logging/logging.ts';

export const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function payloadsSharedInTheProcess() {
  return Layer.succeed(PayloadsShared, sharedPayloadsWithin(hostPayloadCacheBytes));
}
