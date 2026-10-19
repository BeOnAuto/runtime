import { renderClock } from '@on.auto/definitions/template';
import { Conflict, textToKeep, type PlaybookAddress, type RecordedContent } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { briefVariablesOf } from '../brief/brief-dataset.ts';
import { renderedBrief } from '../brief/brief-template.ts';
import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { DatasetFiles } from '../files/files-refusals.ts';
import { periodForm, periodOfForm } from '../periods/grains.ts';

export interface KeptBrief {
  readonly text: string;
  readonly sha256: string;
  readonly bytes: number;
}

function trainingLastOf(document: PredictionFunctionDefinitionDocument, files: DatasetFiles): string {
  const grain = document.predicts.period;
  return periodForm(grain, Number(periodOfForm(grain, files.lastPeriod)) - files.holdout);
}

export function keptBrief(
  content: Pick<RecordedContent, 'put'>,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  { name, files }: { readonly name: string; readonly files: DatasetFiles },
): Effect.Effect<KeptBrief, Conflict> {
  const variables = briefVariablesOf(document, {
    name,
    rows: files.series * (files.window - files.holdout),
    series: files.series,
    firstPeriod: files.firstPeriod,
    lastPeriod: trainingLastOf(document, files),
  });
  return Effect.flatMap(renderClock, (clock) => {
    const rendered = renderedBrief(document.brief, variables, clock);
    if (Result.isFailure(rendered)) {
      return Effect.fail(
        new Conflict({
          detail: `The brief does not render over this dataset within the ${figure(predictionBounds.mostBriefBytes)} bytes a brief may; shorten it or loop over less`,
          kind: 'unworkable',
        }),
      );
    }
    const text = rendered.success;
    return Effect.map(Effect.orDie(content.put(playbook, textToKeep(text, 'text/markdown'))), (kept) => ({
      text,
      sha256: kept.sha256,
      bytes: kept.bytes,
    }));
  });
}
