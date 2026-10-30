import {
  declaredFact,
  definitionChanged,
  definitionChangedBy,
  runFactsOf,
  type CapabilityFacts,
  type DeclaredFact,
} from '@on.auto/definitions';
import {
  changingOne,
  strictRecordedDecoder,
  type KeptContent,
  type PresentedFact,
  type Presenter,
} from '@on.auto/operations';
import type { Schema } from 'effect';

import { buildFactSchemas, type BuildWork } from './build-facts.ts';
import { buildSummaryOf, modelSummaryOf } from './fact-words.ts';
import { ModelFactSchema, modelFactTypes, modelsStreamKind, type RecordedModelFact } from './model-facts.ts';

function presentedBuild(fact: BuildWork): PresentedFact {
  return { type: fact.type, summary: buildSummaryOf(fact), data: fact.data };
}

const declaredOnRuns: readonly DeclaredFact[] = [
  declaredFact('dataset_assembled', buildFactSchemas.dataset_assembled, presentedBuild),
  declaredFact('candidate_uploaded', buildFactSchemas.candidate_uploaded, presentedBuild),
  declaredFact('candidate_refused', buildFactSchemas.candidate_refused, presentedBuild),
  declaredFact('candidate_scored', buildFactSchemas.candidate_scored, presentedBuild),
  declaredFact('candidate_disqualified', buildFactSchemas.candidate_disqualified, presentedBuild),
  declaredFact('baseline_scored', buildFactSchemas.baseline_scored, presentedBuild),
  declaredFact('baseline_not_walked', buildFactSchemas.baseline_not_walked, presentedBuild),
  declaredFact('candidates_fitted', buildFactSchemas.candidates_fitted, presentedBuild),
];

const decodeModelFact = strictRecordedDecoder(ModelFactSchema);

function withKept(data: Schema.JsonObject, content: KeptContent): Schema.JsonObject {
  const kept = ['recipe', 'limitations'].flatMap((name) => {
    const digest = data[`${name}_sha256`];
    const text = typeof digest === 'string' ? content(digest) : undefined;
    return text === undefined ? [] : [[name, text] as const];
  });
  return Object.fromEntries([...Object.entries(data), ...kept]);
}

function presentedModel(fact: RecordedModelFact, content: KeptContent): PresentedFact {
  return { type: fact.type, summary: modelSummaryOf(fact), data: withKept(fact.data, content) };
}

const modelsPresenter: Presenter = {
  streamKind: modelsStreamKind,
  publicNames: Object.fromEntries(modelFactTypes.map((type) => [type, [type]])),
  present: (recorded, content) => [presentedModel(decodeModelFact(recorded), content)],
  changes: changingOne(definitionChanged, modelFactTypes, definitionChangedBy),
};

export const predictionFacts: CapabilityFacts = { onRuns: declaredOnRuns, streams: [modelsPresenter] };

export const buildRunFacts = runFactsOf(declaredOnRuns);
