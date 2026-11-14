import { Conflict } from '@on.auto/operations';
import { Effect, Struct } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionCreatedPaused } from '../imports/paused-creation.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { isTheSameText } from '../payloads/definition-texts.ts';
import type { PortableDefinition } from '../portable/portable-package.ts';
import { playbookImportIn, playbookImportStepped, type ImportMark } from './import-stream.ts';

export const importedReason = 'Imported paused. Resume it when you’re ready.';

function standingIn(type: string, name: string) {
  return Effect.map(loadRegistry(type), (registry) => registry.get(name));
}

function copiedOnce(create: ReturnType<typeof definitionCreatedPaused>) {
  return Effect.fnUntraced(function* (definition: PortableDefinition) {
    const { type, name } = definition;
    const standing = yield* standingIn(type, name);
    if (standing === undefined) {
      yield* create({ ...Struct.omit(definition, ['paused']), reason: importedReason });
    } else if (!isTheSameText(standing.source, { inline: definition.source })) {
      yield* new Conflict({
        detail: `The ${type} ${name} of this playbook is not the one in the package, so the import cannot go on`,
      });
    }
  });
}

export function importCopied(capabilities: readonly Capability[], pages: SubjectPages) {
  const copied = copiedOnce(definitionCreatedPaused(capabilities, pages, true));
  return Effect.fnUntraced(function* (definitions: readonly PortableDefinition[], mark: ImportMark) {
    const { finished } = yield* playbookImportIn;
    if (finished) {
      return;
    }
    yield* Effect.forEach(definitions, copied, { discard: true });
    yield* playbookImportStepped('finish', mark);
  });
}
