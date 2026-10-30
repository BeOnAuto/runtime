import type { ServerInfo } from '@on.auto/api';

import manifest from '../../../../package.json' with { type: 'json' };

export const release: ServerInfo = { name: manifest.name, version: manifest.version };
