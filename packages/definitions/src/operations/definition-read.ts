import { PlaybookContext } from '@on.auto/operations';
import { Effect } from 'effect';

import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { pageOfReading, type PageAsked } from '../page/definition-pages.ts';
import { readDefinition } from './definition-reading.ts';
import { triggersSince } from './registry-access.ts';

interface DefinitionAsked extends PageAsked {
  readonly type: string;
  readonly name: string;
}

export function definitionRead(capabilities: readonly DefinitionKind[]) {
  const known = knownCapabilities(capabilities);
  return Effect.fnUntraced(function* ({ type, name, ...asked }: DefinitionAsked) {
    const capability = yield* known.capabilityOfType(type);
    const { stored, definition: read } = yield* readDefinition(capability, known.usingTypes, name);
    const definition =
      (stored.triggers ?? []).length > 0 && stored.status === 'active'
        ? { ...read, triggers_since: yield* triggersSince(capability.type, stored) }
        : read;
    const { org, playbook } = yield* PlaybookContext;
    const standing = yield* capability.standing({
      org,
      playbook,
      name,
      version: definition.version,
      status: definition.status,
      ...(stored.details === undefined ? {} : { details: stored.details }),
    });
    const page = yield* pageOfReading({ capabilities, capability, stored }, asked);
    return { ...definition, ...(standing === undefined ? {} : { standing }), ...page };
  });
}
