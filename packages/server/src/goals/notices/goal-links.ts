import { goalLinksOver, type GoalLinkOf } from '@on.auto/goals';
import { isHttpsOrLoopback, studioLinkOf, type StudioSettings } from '@on.auto/identity';

import type { StudioAddress } from '../../workflows/host-dependencies.ts';

export function goalLinksOnNode(studio: StudioSettings, ownOrigin: () => string): GoalLinkOf {
  return (place) => {
    const origin = ownOrigin();
    const linkTo = isHttpsOrLoopback(origin)
      ? goalLinksOver((page) =>
          studioLinkOf(studio, { ownOrigin: origin, openedFrom: 'agent', installId: undefined, page }),
        )
      : goalLinksOver(null);
    return linkTo(place);
  };
}

export function goalLinksOf({ studio, runtime }: StudioAddress): GoalLinkOf {
  return goalLinksOnNode(studio, runtime);
}
