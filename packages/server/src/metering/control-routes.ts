import { problemOf, problemResponse, type RegisterRoutes, type RouteHandler } from '@on.auto/api';
import { isKeyHolder, type Principal } from '@on.auto/identity';
import { LicenseServiceRefused, type RuntimeRuns, type SelfHostedMeter } from '@on.auto/meter';
import type { StreamReader } from '@on.auto/operations';

import { activationKey, allocationId, ControlInputRefused, controlInput } from './control-input.ts';
import { controlledWork } from './control-work.ts';
import { meterResponse, meterStatus } from './status.ts';

function isOperator({ own }: Principal, keys: ReadonlySet<string>): boolean {
  return (own.id === 'local' && own.org === 'local') || (isKeyHolder(own) && keys.has(own.id));
}

function refused(error: unknown): Response {
  if (error instanceof ControlInputRefused) return problemResponse(problemOf(error.reason, error.message));
  if (error instanceof LicenseServiceRefused && [400, 401, 403, 404, 409].includes(error.status))
    return problemResponse(problemOf('conflict', 'The account service refused this license request.'));
  return problemResponse(problemOf('unavailable', 'The Runtime meter could not complete this request. Try again.'));
}

export function licenseControls(
  meter: SelfHostedMeter,
  runs: RuntimeRuns,
  reader: StreamReader,
  operatorKeyIds: readonly string[],
) {
  const keys = new Set(operatorKeyIds);
  const work = controlledWork();
  const guarded =
    (perform: (request: Readonly<Request>) => Promise<unknown>): RouteHandler =>
    async (context) => {
      if (!isOperator(context.get('principal'), keys))
        return problemResponse(problemOf('forbidden', 'Installation license controls require a Runtime operator.'));
      try {
        return meterResponse(await work.run(() => perform(context.req.raw)));
      } catch (error) {
        return refused(error);
      }
    };
  const routes: RegisterRoutes = ({ add }) => {
    add(
      'GET',
      '/v1/runtime/license',
      guarded(() => meterStatus(meter)),
    );
    add(
      'POST',
      '/v1/runtime/license/activate',
      guarded(async (request) => meter.license.activate(activationKey(await controlInput(request)))),
    );
    add('POST', '/v1/runtime/license/refresh', guarded(meter.license.refresh));
    add(
      'POST',
      '/v1/runtime/license/report',
      guarded(async () => ({
        reconciliation: await runs.reconcile({ reader }),
        delivery: (await meter.reporting.send()) ?? null,
      })),
    );
    add(
      'POST',
      '/v1/runtime/license/close',
      guarded(async (request) => meter.reporting.requestClose(allocationId(await controlInput(request)))),
    );
  };
  return { routes, stop: work.stop };
}
