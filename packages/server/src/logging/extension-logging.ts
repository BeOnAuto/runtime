import { Effect } from 'effect';

import type { LoadedExtension } from '../extensions/extension-loading.ts';

const provenanceWords: Readonly<Record<LoadedExtension['provenance'], string>> = {
  configured: 'listed in the settings',
  release: 'of the release',
};

function filledWords(provides: LoadedExtension['provides']): string {
  return provides.length === 0 ? 'filling no point' : `filling ${provides.map(({ point }) => point).join(', ')}`;
}

function extensionWords({ package: name, version, provenance, provides }: LoadedExtension): string {
  return `${name} ${version}, ${provenanceWords[provenance]}, ${filledWords(provides)}`;
}

export function logExtensions(extensions: readonly LoadedExtension[]): Effect.Effect<void> {
  const loaded = extensions.length === 0 ? 'none' : extensions.map((extension) => extensionWords(extension)).join('; ');
  return Effect.logInfo(`Extensions loaded, in their order of precedence: ${loaded}`).pipe(
    Effect.annotateLogs({
      extensions: extensions.map(({ package: name, version, provenance, provides }) => ({
        package: name,
        version,
        provenance,
        provides: provides.map(({ point, contract }) => `${point}@${contract}`),
      })),
    }),
  );
}
