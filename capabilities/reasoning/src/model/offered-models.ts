import { Option } from 'effect';

import { modelOffer } from './model-offer.ts';
import { parseModelReference } from './model-reference.ts';

export interface OfferedModels {
  readonly providers: readonly string[];
  readonly aliases: readonly string[];
}

export function offeredModels(
  providers: readonly string[],
  aliases: ReadonlyMap<string, string>,
  allowed: readonly string[] | null,
): OfferedModels {
  const offer = modelOffer(allowed);
  return {
    providers: providers.filter((provider) => offer.reaches(`${provider}/*`)),
    aliases: [...aliases]
      .filter(
        ([alias, target]: readonly [string, string]) =>
          providers.includes(Option.getOrThrow(parseModelReference(target)).provider) &&
          (offer.reaches(alias) || offer.reaches(target)),
      )
      .map(([alias]: readonly [string, string]) => alias),
  };
}
