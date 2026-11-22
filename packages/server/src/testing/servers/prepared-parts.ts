import { preparedPolicies, type PreparePolicies } from '@on.auto/access-control';
import { renderedGuidePages, type GuidePages } from '@on.auto/api';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import { compositionRootWith, type CompositionParts } from '../../composition/composition-root.ts';
import { shippedRoots } from '../../server-options/shipped-roots.ts';
import type { ShippedSettings } from '../../settings/served-settings.ts';
import { readShippedSettings } from '../../settings/shipped-settings.ts';
import { migratedLedgerImage } from '../records/migrated-ledger.ts';

export type PreparedParts = Required<
  Pick<CompositionParts, 'guidePages' | 'preparingPolicies' | 'shippedSettings' | 'ledgerImage'>
>;

/** The value as given, it and every object and function it holds frozen. */
export function deeplyFrozen<Value>(value: Value, seen: WeakSet<object> = new WeakSet()): Value {
  if (((typeof value === 'object' && value !== null) || typeof value === 'function') && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const held of Object.values(value)) {
      deeplyFrozen(held, seen);
    }
  }
  return value;
}

/** A map no one can change: it reads as the map given, and has no way to set, delete or clear an entry. */
export function readOnlyMapOf<Key, Value>(given: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  const kept = new Map(given);
  const readOnly: ReadonlyMap<Key, Value> = deeplyFrozen({
    get size() {
      return kept.size;
    },
    get: (key: Key) => kept.get(key),
    has: (key: Key) => kept.has(key),
    entries: () => kept.entries(),
    keys: () => kept.keys(),
    values: () => kept.values(),
    forEach: (each: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void) => {
      for (const [key, value] of kept) {
        each(value, key, readOnly);
      }
    },
    [Symbol.iterator]: () => kept[Symbol.iterator](),
  });
  return readOnly;
}

/**
 * What `prepare` answers, prepared by it the first time each question is asked and the same frozen answer every time
 * after, so a process prepares each once; a question it fails is asked of it again.
 */
export function preparedOnce<Asked extends readonly unknown[], Answer>(
  prepare: (...asked: Asked) => Answer,
  keyOf: (...asked: Asked) => string,
): (...asked: Asked) => Answer {
  const answers = new Map<string, Answer>();
  return (...asked) => {
    const key = keyOf(...asked);
    const kept = answers.get(key);
    if (kept !== undefined) {
      return kept;
    }
    const answer = prepare(...asked);
    Object.freeze(answer);
    answers.set(key, answer);
    return answer;
  };
}

function guidePagesPreparedOnce({ forTheAgent, asHtml }: GuidePages): GuidePages {
  return {
    forTheAgent: preparedOnce(forTheAgent, (path, written, variables) => JSON.stringify([path, written, variables])),
    asHtml: preparedOnce(asHtml, (markdown) => markdown),
  };
}

async function shippedSettingsPrepared(): Promise<ShippedSettings> {
  const { providers } = await readShippedSettings(shippedFilesOnDisk(shippedRoots));
  return { providers: { providers: providers.providers, documents: readOnlyMapOf(providers.documents) } };
}

const policiesPreparedOnce: PreparePolicies = preparedOnce(preparedPolicies, (_cedar, { schema, policies }) =>
  JSON.stringify([schema, policies]),
);

/**
 * What every test server starts from in place of preparing it again: the guide pages as an agent and the page at
 * /debug read them, the access policies as the decision engine holds them, the providers the release ships, and the
 * image of an empty migrated ledger, which a ledger in memory opens a copy of. Each is
 * prepared once in the process by the code a real start runs, and is frozen, so no server or test changes what the
 * next one is given.
 */
export const preparedParts: PreparedParts = deeplyFrozen({
  guidePages: guidePagesPreparedOnce(renderedGuidePages),
  preparingPolicies: policiesPreparedOnce,
  shippedSettings: await shippedSettingsPrepared(),
  ledgerImage: await migratedLedgerImage(),
});

/** The shipped composition with the parts given, from `preparedParts` unless the server is preparing them itself. */
export function compositionOfATestServer(
  modelAccessOf: Parameters<typeof compositionRootWith>[0],
  parts: CompositionParts,
  preparingItself?: true,
): ReturnType<typeof compositionRootWith> {
  return compositionRootWith(modelAccessOf, preparingItself === undefined ? { ...preparedParts, ...parts } : parts);
}
