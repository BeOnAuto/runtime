import type { ModelFactOf, RecordedModelFact } from '../facts/model-facts.ts';

export interface BuiltVersion {
  readonly version: number;
  readonly build: string;
  readonly dataSha256: string;
  readonly definitionVersion: number;
  readonly fileSha256: string;
  readonly fileFormat: string;
  readonly builtAt: number;
  readonly card: ModelFactOf<'version_built'>['data'];
}

export type ShadowPrediction = ModelFactOf<'shadow_predicted'>['data'];

export type ShadowGrade = ModelFactOf<'shadow_graded'>['data'];

export interface AskedBuild {
  readonly build: string;
  readonly askedAt: number;
}

export interface ModelsState {
  readonly asked: readonly AskedBuild[];
  readonly ended: ReadonlySet<string>;
  readonly versions: readonly BuiltVersion[];
  readonly active: number | null;
  readonly predicted: readonly ShadowPrediction[];
  readonly graded: readonly ShadowGrade[];
  readonly verdicts: ReadonlyMap<number, boolean>;
  readonly settled: ReadonlySet<string>;
}

export const noModels: ModelsState = {
  asked: [],
  ended: new Set(),
  versions: [],
  active: null,
  predicted: [],
  graded: [],
  verdicts: new Map(),
  settled: new Set(),
};

function settledWith(settled: ReadonlySet<string>, build: string | undefined): ReadonlySet<string> {
  return build === undefined ? settled : new Set([...settled, build]);
}

function builtOf({ data, context }: Extract<RecordedModelFact, { readonly type: 'version_built' }>): BuiltVersion {
  return {
    version: data.version,
    build: data.build,
    dataSha256: data.dataset.data_sha256,
    definitionVersion: context.definitionVersion,
    fileSha256: data.file.sha256,
    fileFormat: data.file.format,
    builtAt: Date.parse(context.at),
    card: data,
  };
}

function claimed(
  state: ModelsState,
  fact: Extract<RecordedModelFact, { readonly type: 'build_asked' | 'build_ended' }>,
) {
  return fact.type === 'build_asked'
    ? { ...state, asked: [...state.asked, { build: fact.data.build, askedAt: Date.parse(fact.data.asked_at) }] }
    : { ...state, ended: new Set([...state.ended, fact.data.build]) };
}

export function evolveModels(state: ModelsState, fact: RecordedModelFact): ModelsState {
  if (fact.type === 'build_asked' || fact.type === 'build_ended') {
    return claimed(state, fact);
  }
  if (fact.type === 'version_built') {
    return { ...state, versions: [...state.versions, builtOf(fact)] };
  }
  if (fact.type === 'shadow_predicted') {
    return { ...state, predicted: [...state.predicted, fact.data] };
  }
  if (fact.type === 'shadow_graded') {
    return { ...state, graded: [...state.graded, fact.data] };
  }
  if (fact.type === 'shadow_passed' || fact.type === 'shadow_failed') {
    return { ...state, verdicts: new Map([...state.verdicts, [fact.data.version, fact.type === 'shadow_passed']]) };
  }
  const settled = settledWith(state.settled, fact.data.build);
  return fact.type === 'version_activated' ? { ...state, active: fact.data.version, settled } : { ...state, settled };
}

export function builtVersionOf(state: ModelsState, version: number): BuiltVersion | undefined {
  return state.versions.find((built) => built.version === version);
}

export function versionOfBuild(state: ModelsState, build: string): BuiltVersion | undefined {
  return state.versions.find((built) => built.build === build);
}

export function wasPredicted(
  state: ModelsState,
  { version, of, origin }: Pick<ShadowPrediction, 'version' | 'of' | 'origin'>,
): boolean {
  return state.predicted.some((each) => each.version === version && each.of === of && each.origin === origin);
}

function unlicensedOriginsOf(state: ModelsState, version: number): ReadonlySet<string> {
  return new Set(
    state.predicted
      .filter((each) => each.version === version && each.because === 'feature_unlicensed')
      .map(({ origin }) => origin),
  );
}

export function unlicensedClosesOf(state: ModelsState, version: number): number {
  return unlicensedOriginsOf(state, version).size;
}

export function licensedPredictionsOf(state: ModelsState, version: number): readonly ShadowPrediction[] {
  const unlicensed = unlicensedOriginsOf(state, version);
  return state.predicted.filter((each) => each.version === version && !unlicensed.has(each.origin));
}

export function wasGraded(
  state: ModelsState,
  { version, of, period }: Pick<ShadowGrade, 'version' | 'of' | 'period'>,
): boolean {
  return state.graded.some((each) => each.version === version && each.of === of && each.period === period);
}
