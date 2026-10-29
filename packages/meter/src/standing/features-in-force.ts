import { standingAllocation } from '../allocations/allocation.ts';
import { isLiveAt } from '../licensing/licensing.ts';
import { footingOf, type Footing } from '../meter-stream/local-admission.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';

function featuresOfTheFooting(footing: Footing, offline: boolean): readonly string[] {
  if (footing.kind === 'licensed') return footing.license.features;
  if (footing.kind !== 'limited' || 'refused' in footing || !('license' in footing)) return [];
  return offline || footing.because !== 'out_of_touch' ? footing.license.features : [];
}

export function featuresInForceOf(state: MeterState, sha256: string | undefined, at: string): readonly string[] {
  const allocation = standingAllocation(state);
  if (allocation === undefined) return featuresOfTheFooting(footingOf(state, sha256, at), false);
  return isLiveAt(allocation.refresh_by, Date.parse(at))
    ? featuresOfTheFooting(footingOf(state, sha256, at), true)
    : [];
}
