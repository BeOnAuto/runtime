import { defaultStudioOrigin } from '@on.auto/identity';

import type { HostedStudio, ServedStudio, StudioAnswer } from '../studio/served-studio.ts';

export const hostedStudio: HostedStudio = { origin: defaultStudioOrigin, served: false };

const noAnswers: ReadonlyMap<string, StudioAnswer> = new Map();

export const servedStudio: ServedStudio = {
  origin: defaultStudioOrigin,
  served: true,
  host: (path) => Promise.resolve(noAnswers.get(path)),
};
