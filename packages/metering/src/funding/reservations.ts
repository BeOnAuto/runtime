import { checkedCreditUnits } from '../quantities/credits.ts';
import {
  usableLots,
  type AvailableLot,
  type FundingCategory,
  type FundingRequest,
  type LotReservation,
} from './lots.ts';
import { fundingNetwork } from './residual-network.ts';

const categories: readonly FundingCategory[] = ['resource', 'development', 'platform'];

export function reserveFromLots(lots: readonly AvailableLot[], request: FundingRequest): readonly LotReservation[] {
  const amounts = {
    platform: checkedCreditUnits(request.platformUnits),
    resource: checkedCreditUnits(request.resourceUnits),
    development: checkedCreditUnits(request.developmentUnits),
  };
  const total = checkedCreditUnits(amounts.platform + amounts.resource + amounts.development);
  const available = usableLots(lots, request);
  const network = fundingNetwork();
  const freeLimit = request.route === 'cloud' ? request.cloudFreeRemainingUnits : total;
  network.connect('source', 'free', freeLimit, 0n);
  for (const category of categories) network.connect(category, 'sink', amounts[category], 0n);
  const tracked: Readonly<{ rank: number; lotId: string; category: FundingCategory; used: () => bigint }>[] = [];
  let preference = 1n;
  for (const [index, lot] of available.toReversed().entries()) {
    const node = `lot-${index}`;
    network.connect(lot.source === 'free' ? 'free' : 'source', node, lot.availableUnits, -preference);
    preference *= total + 1n;
    for (const category of categories.filter((candidate) => lot.categories.includes(candidate))) {
      const used = network.connect(node, category, lot.availableUnits, 0n);
      tracked.push({ rank: index, lotId: lot.id, category, used });
    }
  }
  if (!network.fill('source', 'sink', total))
    throw new RangeError('Insufficient eligible credits within the shared balance and daily allowance');
  return tracked
    .toSorted((first, second) => second.rank - first.rank)
    .map<LotReservation>(({ lotId, category, used }) => ({ lotId, category, units: used() }))
    .filter((part) => part.units > 0n);
}
