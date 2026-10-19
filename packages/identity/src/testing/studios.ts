import { defaultStudioOrigin, type StudioSettings } from '../access/studio.ts';

export const hostedStudio: StudioSettings = { origin: defaultStudioOrigin, served: false };

export const servedStudio: StudioSettings = { origin: defaultStudioOrigin, served: true };
