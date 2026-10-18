import type { ToolReference } from '@on.auto/tool-servers';

import { named, type Phrases } from '../overview/overview.ts';

export function theToolOf({ server, tool }: ToolReference): Phrases {
  return ['the tool ', named(tool), ' of ', named(server)];
}
