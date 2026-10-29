import { Conflict } from '@on.auto/operations';

import type { MeterOptions } from '../admission/metering.ts';
import type { FreeRateReached } from '../meter-stream/meter-commands.ts';
import { freeRateCaseOf, liftWords } from './free-rate-cases.ts';

export function freeRateRefusalOf(options: MeterOptions): (reached: FreeRateReached) => Conflict {
  return ({ installation, footing, limit, rate, licensedEver, at }) => {
    const {
      kind,
      why,
      fix,
      resolve_at: resolveAt,
    } = freeRateCaseOf(footing, {
      options,
      installation,
      licensedEver,
      rate,
    });
    return new Conflict({
      detail: `${why} ${liftWords(limit, rate, at)} ${fix}`,
      kind,
      because: limit,
      resolve_at: resolveAt,
      runtime_id: installation,
    });
  };
}
