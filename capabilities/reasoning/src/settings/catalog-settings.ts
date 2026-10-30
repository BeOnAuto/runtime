import { decodedJsonSettingWith, strictly, type SettingDecoder } from '@on.auto/config';
import { JsonPointer, Option, Result, Schema } from 'effect';

import { aliasPatternOf, namesModels, patternsOverlap, wildcardsAreTrailing } from '../model/model-alias.ts';
import {
  hasOnlyVisibleCharacters,
  isModelId,
  mostModelIdCharacters,
  namesAnArn,
  parseModelReference,
} from '../model/model-reference.ts';
import { problemAt, type SettingProblem } from './setting-values.ts';

export interface CatalogReading {
  readonly problems: readonly SettingProblem[];
  readonly declared: ReadonlyMap<string, readonly string[]>;
  readonly allowed: readonly string[] | null;
}

export interface CatalogContext {
  readonly gateways: readonly string[];
  readonly providers: readonly string[];
  readonly aliases: ReadonlyMap<string, string>;
}

type Declarations = Readonly<Record<string, readonly string[]>>;

const declaredSetting = 'DECLARED_MODELS';

const allowedSetting = 'ALLOWED_MODELS';

export const providersDeclaringModels: readonly string[] = [
  'bedrock',
  'bedrock-anthropic',
  'azure',
  'vertex',
  'vertex-anthropic',
];

const providersListingModels: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google']);

const declaringProviders = `models are declared for ${providersDeclaringModels.join(', ')} or a gateway of MODEL_GATEWAYS`;

const providerPrefix = /^[a-z][a-z0-9-]{0,31}$/u;

export const DeclaredModelsSchema = Schema.Record(
  Schema.String,
  Schema.Array(
    Schema.String.annotate({
      description: 'A model id as the provider receives it, such as eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    }),
  ),
);

export const AllowedModelsSchema = Schema.Array(
  Schema.String.annotate({
    description:
      'A model reference a reasoning function may give, written provider/model, or provider/* for every model of a provider',
  }),
);

const decodeDeclarations: SettingDecoder<Declarations> = Schema.decodeUnknownResult(DeclaredModelsSchema, strictly);

const decodeAllowed: SettingDecoder<readonly string[]> = Schema.decodeUnknownResult(AllowedModelsSchema, strictly);

function declaredProblem(pointer: string, detail: string): readonly SettingProblem[] {
  return problemAt(declaredSetting, pointer, detail);
}

function providerProblems(provider: string, gateways: readonly string[]): readonly SettingProblem[] {
  const pointer = `/${JsonPointer.escapeToken(provider)}`;
  if (providersListingModels.has(provider)) {
    return declaredProblem(pointer, `${provider} lists its own models; ${declaringProviders}`);
  }
  return providersDeclaringModels.includes(provider) || gateways.includes(provider)
    ? []
    : declaredProblem(pointer, `There is no provider named ${provider}; ${declaringProviders}`);
}

function modelIdProblem(id: string, position: number, ids: readonly string[]): string | undefined {
  if (!isModelId(id)) {
    return `Expected a model id of 1 to ${mostModelIdCharacters} characters, without spaces or control characters`;
  }
  if (id.includes('*')) {
    return 'A declared model is one model id, without a *';
  }
  if (namesAnArn(id)) {
    return 'An ARN names an account and a region, which the list of models never shows; give it an alias in MODEL_ALIASES, which is listed by its own name';
  }
  return ids.indexOf(id) < position ? `${id} is declared twice` : undefined;
}

function declarationProblems(
  [provider, ids]: readonly [string, readonly string[]],
  gateways: readonly string[],
): readonly SettingProblem[] {
  const at = `/${JsonPointer.escapeToken(provider)}`;
  return [
    ...providerProblems(provider, gateways),
    ...ids.flatMap((id, position) => {
      const detail = modelIdProblem(id, position, ids);
      return detail === undefined ? [] : declaredProblem(`${at}/${position}`, detail);
    }),
  ];
}

function shapeProblem(reference: string): string | undefined {
  if (!wildcardsAreTrailing(reference, reference) || !namesModels(reference)) {
    return 'Expected provider/model, or provider/ followed by a * that stands for any model id';
  }
  if (!hasOnlyVisibleCharacters(reference)) {
    return 'Expected a reference without spaces or control characters';
  }
  return providerPrefix.test(Option.getOrThrow(parseModelReference(reference)).provider)
    ? undefined
    : 'Expected a provider prefix of lowercase letters, digits and hyphens, starting with a letter';
}

function matchesSomething(reference: string, { providers, aliases }: CatalogContext): boolean {
  const pattern = aliasPatternOf(reference);
  return (
    providers.includes(Option.getOrThrow(parseModelReference(reference)).provider) ||
    [...aliases.keys()].some((alias) => patternsOverlap(aliasPatternOf(alias), pattern))
  );
}

function reachProblem(reference: string, context: CatalogContext): string | undefined {
  if (namesAnArn(reference)) {
    return 'An ARN names an account and a region; allow the name of an alias in MODEL_ALIASES that is sent to it instead';
  }
  return matchesSomething(reference, context)
    ? undefined
    : `There is no provider named ${Option.getOrThrow(parseModelReference(reference)).provider}, nor an alias that ${reference} matches`;
}

function allowedProblem(
  reference: string,
  position: number,
  allowed: readonly string[],
  context: CatalogContext,
): string | undefined {
  if (allowed.indexOf(reference) < position) {
    return `${reference} is listed twice`;
  }
  return shapeProblem(reference) ?? reachProblem(reference, context);
}

function allowedProblems(allowed: readonly string[], context: CatalogContext): readonly SettingProblem[] {
  if (allowed.length === 0) {
    return problemAt(
      allowedSetting,
      '',
      `Expected at least one model; leave ${allowedSetting} out to offer every model`,
    );
  }
  return allowed.flatMap((reference, position) => {
    const detail = allowedProblem(reference, position, allowed, context);
    return detail === undefined ? [] : problemAt(allowedSetting, `/${position}`, detail);
  });
}

function declaredReading(
  text: string | undefined,
  gateways: readonly string[],
): Pick<CatalogReading, 'problems' | 'declared'> {
  if (text === undefined) {
    return { problems: [], declared: new Map() };
  }
  return Result.match(decodedJsonSettingWith(declaredSetting, text, decodeDeclarations), {
    onSuccess: (declarations) => {
      const entries = Object.entries(declarations);
      return {
        problems: entries.flatMap((entry: readonly [string, readonly string[]]) =>
          declarationProblems(entry, gateways),
        ),
        declared: new Map(entries),
      };
    },
    onFailure: (problems) => ({ problems, declared: new Map() }),
  });
}

function allowedReading(
  text: string | undefined,
  context: CatalogContext,
): Pick<CatalogReading, 'problems' | 'allowed'> {
  if (text === undefined) {
    return { problems: [], allowed: null };
  }
  return Result.match(decodedJsonSettingWith(allowedSetting, text, decodeAllowed), {
    onSuccess: (allowed) => ({ problems: allowedProblems(allowed, context), allowed }),
    onFailure: (problems) => ({ problems, allowed: null }),
  });
}

export function catalogReading(
  declaredText: string | undefined,
  allowedText: string | undefined,
  context: CatalogContext,
): CatalogReading {
  const declared = declaredReading(declaredText, context.gateways);
  const allowed = allowedReading(allowedText, context);
  return {
    problems: [...declared.problems, ...allowed.problems],
    declared: declared.declared,
    allowed: allowed.allowed,
  };
}
