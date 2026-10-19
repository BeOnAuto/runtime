import { withUserAgent } from '@on.auto/outbound';

import { release } from './release.ts';

export const outboundFetch = withUserAgent(globalThis.fetch, `auto-runtime/${release.version}`);
