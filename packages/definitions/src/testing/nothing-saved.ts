import { Effect } from 'effect';

import type { SavedDefinitions } from '../capability/saved-definitions.ts';

export const nothingSaved: SavedDefinitions = { active: () => Effect.undefined, content: () => Effect.undefined };
