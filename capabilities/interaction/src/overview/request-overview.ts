import {
  bulletList,
  durationInWords,
  inputSection,
  paragraph,
  schemaBlocks,
  sectionOf,
  templateLead,
  theToolOf,
  type OverviewSection,
} from '@on.auto/definitions';
import { readableTemplate } from '@on.auto/definitions/template';

import type { RequestDocument } from '../document/interaction-document.ts';
import { partyBlocks, replyRuleItems } from './request-words.ts';

const notification = 'None: it is a notification, which takes no answer and succeeds once its request is delivered.';

function whoSection({ to, from }: RequestDocument): OverviewSection {
  const answerer =
    from === undefined ? [] : partyBlocks('Its answerer, whose reply counts, is', readableTemplate(from));
  return sectionOf(
    'Who it asks',
    ...partyBlocks('It asks a person, and each request goes to', readableTemplate(to)),
    ...answerer,
  );
}

function whereSection({ route, output }: RequestDocument): OverviewSection {
  if (route === undefined) {
    const reads = output.schema === undefined ? 'reads it' : 'reads and answers it';
    return sectionOf(
      'Where',
      paragraph(
        `It leaves the request in the playbook's inbox, where a caller who may write to the playbook ${reads}.`,
      ),
    );
  }
  return sectionOf('Where', paragraph('It sends the request through ', ...theToolOf(route.deliver), '.'));
}

function waitSection({ expiresMs, output }: RequestDocument): OverviewSection {
  const duration = durationInWords(expiresMs);
  return sectionOf(
    'How long it waits',
    paragraph(
      output.schema === undefined
        ? `Its request expires after ${duration}.`
        : `It waits up to ${duration} for the answer; a request nobody answers by then ends unanswered.`,
    ),
  );
}

function repliesSections({ route, reply, from }: RequestDocument): readonly OverviewSection[] {
  if (route?.replies === undefined || reply === undefined) {
    return [];
  }
  const { tool, tell } = route.replies;
  const answerer = from === undefined ? 'the party it goes to' : 'its answerer';
  const told = tell === undefined ? '' : ', and the party is told how to answer';
  return [
    sectionOf(
      'Replies',
      paragraph(
        'It reads the replies to its message with ',
        ...theToolOf({ server: route.deliver.server, tool }),
        `, and a reply from ${answerer} answers it when its reply rule reads it:`,
      ),
      bulletList(replyRuleItems(reply)),
      paragraph(`A reply the rule cannot read is refused${told}.`),
    ),
  ];
}

export function requestSections(document: RequestDocument): readonly OverviewSection[] {
  return [
    inputSection(document.input.schema?.document),
    whoSection(document),
    sectionOf('What it sends', templateLead('Its message', 'run'), ...readableTemplate(document.message)),
    whereSection(document),
    waitSection(document),
    sectionOf('What answer it expects', ...schemaBlocks(document.output.schema?.document, notification)),
    ...repliesSections(document),
  ];
}
