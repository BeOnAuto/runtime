import { describe, expect, it } from 'vitest';

import { eventFilterPhrases, plainTextOf, type EventFilter, type Phrases } from '../index.ts';

function plain(phrases: Phrases): string {
  return phrases
    .map((phrase) => {
      if (typeof phrase === 'string') {
        return phrase;
      }
      return 'name' in phrase ? `**${phrase.name}**` : `\`${plainTextOf([phrase])}\``;
    })
    .join('');
}

function wordsOf(...filters: readonly EventFilter[]): readonly string[] {
  return filters.map((filter) => plain(eventFilterPhrases(filter)));
}

describe('an event filter in words', () => {
  it('says each event type of the playbook, with the definition its subject or source names', () => {
    expect(
      wordsOf(
        { type: 'run_started', subject: 'workflow/greet' },
        { type: 'run_succeeded', subject: 'reasoning/review-brief' },
        { type: 'run_failed' },
        { type: 'run_rejected', subject: 'computation/campaign-pace' },
        { type: 'definition_created', source: '/definitions/recall/campaign-reviews' },
        { type: 'definition_updated' },
        { type: 'definition_retired', source: '/definitions/workflow/greet' },
        { type: 'campaign_launched' },
      ),
    ).toEqual([
      'a run of the workflow **greet** starts',
      'a run of the reasoning function **review-brief** succeeds',
      'a run of any function or workflow fails',
      'a run of the computation function **campaign-pace** is rejected',
      'the recall function **campaign-reviews** is created',
      'any function or workflow is updated',
      'the workflow **greet** is retired',
      'an event `campaign_launched` is published to the playbook',
    ]);
  });
});

describe('the conditions of an event filter in words', () => {
  it('say each other attribute a filter names, its source, subject, caller and data among them', () => {
    expect(
      wordsOf(
        { type: 'run_succeeded', subject: 'oddly' },
        { type: 'definition_created', source: '/runs/0199a3c4' },
        { type: 'run_succeeded', subject: 'prediction/weekly-orders', caller: 'acme-admin' },
        { type: 'run_started', caller: 'playbook:finance', triggerkind: 'event' },
        { type: 'campaign_launched', source: 'crm', subject: 'eu', data: { region: 'eu' } },
        { type: 'order_placed', data: '${ $data.revenue > 100 }' },
        { type: 'run_succeeded', depth: 2, definitionversion: 3 },
        { type: 'definition_updated', source: '/definitions/review-brief/' },
        { type: 'run_failed', subject: 7 },
      ),
    ).toEqual([
      'a run succeeds, with the subject `oddly`',
      'a definition is created, from the source `/runs/0199a3c4`',
      'a run of the prediction function **weekly-orders** succeeds, when the caller is `acme-admin`',
      'a run of any function or workflow starts, when the caller is the playbook `finance`, as for a run a trigger started and the runs it calls and when its `triggerkind` is `event`',
      'an event `campaign_launched` is published to the playbook, from the source `crm` and with the subject `eu` and when its data is exactly `{"region":"eu"}`',
      'an event `order_placed` is published to the playbook, when `$data.revenue > 100` holds for its data',
      'a run of any function or workflow succeeds, when its `depth` is `2` and when its `definitionversion` is `3`',
      'a definition is updated, from the source `/definitions/review-brief/`',
      'a run fails, with the subject `7`',
    ]);
  });
});
