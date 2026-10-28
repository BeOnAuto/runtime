import { renderClock } from '@on.auto/definitions/template';
import { textToKeep, type Conflict, type PlaybookAddress, type RecordedContent } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { briefVariablesOf } from '../brief/brief-dataset.ts';
import { renderedBrief, unworkableBrief } from '../brief/brief-template.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { DatasetFiles } from '../files/files-refusals.ts';
import { periodForm, periodOfForm } from '../periods/grains.ts';
import { candidateFilesOf } from '../runtimes/format-words.ts';
import { fedShapeOf, formatsAcceptedFor } from '../runtimes/model-runtimes.ts';

export interface KeptBrief {
  readonly text: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly formats: readonly string[];
}

function trainingLastOf(document: PredictionFunctionDefinitionDocument, files: DatasetFiles): string {
  const grain = document.predicts.period;
  return periodForm(grain, Number(periodOfForm(grain, files.lastPeriod)) - files.holdout);
}

export interface Briefing {
  readonly name: string;
  readonly files: DatasetFiles;
  readonly runtimes: Parameters<typeof formatsAcceptedFor>[0];
}

function withTheCandidates(rendered: string, formats: readonly string[]): string {
  return `${rendered}\n\n## Candidates\n\nEach upload of a candidate takes ${candidateFilesOf(formats)}.\n`;
}

export function keptBrief(
  content: Pick<RecordedContent, 'put'>,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  { name, files, runtimes }: Briefing,
): Effect.Effect<KeptBrief, Conflict> {
  const formats = formatsAcceptedFor(runtimes, fedShapeOf(document)).map(({ format }) => format);
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
      return Effect.fail(unworkableBrief);
    }
    const text = withTheCandidates(rendered.success, formats);
    return Effect.map(Effect.orDie(content.put(playbook, textToKeep(text, 'text/markdown'))), (kept) => ({
      text,
      sha256: kept.sha256,
      bytes: kept.bytes,
      formats,
    }));
  });
}
