import { durationInWords, named, paragraph, sectionOf, templateLead, type OverviewSection } from '@on.auto/definitions';
import { readableTemplate, type TemplateText } from '@on.auto/definitions/template';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { BuildSource } from '../document/prediction-document.ts';

const { candidatesInABuild, scoringACandidateMs } = predictionBounds;

function askedThrough({ through, to }: BuildSource) {
  return through === undefined
    ? paragraph("Each build asks for candidate models in the playbook's inbox, as a request to ", named(to), '.')
    : paragraph('Each build asks for candidate models through the interaction function ', named(through), '.');
}

function briefBlocks(written: TemplateText) {
  const brief = readableTemplate(written);
  return brief.length === 0
    ? [paragraph('Its brief holds no text a trainer reads, so its trainer reads the rows and the rules alone.')]
    : [templateLead('Its trainer reads the brief first', 'build'), ...brief];
}

export function trainerSection(buildSource: BuildSource, brief: TemplateText): OverviewSection {
  return sectionOf(
    'Who trains it',
    askedThrough(buildSource),
    paragraph(
      `A build waits at most ${durationInWords(buildSource.expiresMs)} for its candidates, and the playbook then scores up to ${candidatesInABuild} of them, each within ${durationInWords(scoringACandidateMs)}.`,
    ),
    ...briefBlocks(brief),
  );
}
