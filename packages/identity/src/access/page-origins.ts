import type { StudioSettings } from './studio.ts';

export interface PageSettings {
  readonly studio: StudioSettings;
  readonly allowedOrigins: readonly string[];
}

export function pageOriginsOf({ studio, allowedOrigins }: PageSettings, ownOrigin: string): readonly string[] {
  return [studio.origin, ...(studio.served ? [ownOrigin] : []), ...allowedOrigins];
}
