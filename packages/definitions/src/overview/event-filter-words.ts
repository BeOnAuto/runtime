import { enclosedBody } from '@on.auto/workflow-engine';
import type { Schema } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { named, type Phrase, type Phrases } from './overview.ts';
import { valueText } from './schema-reading.ts';

export type EventFilter = Schema.JsonObject & { readonly type: string };

interface Happening {
  readonly who: Phrases;
  readonly verb: string;
  readonly said?: string;
}

type Attribute = readonly [string, Schema.Json];

const runVerbs: ReadonlyMap<string, string> = new Map([
  ['run_started', 'starts'],
  ['run_succeeded', 'succeeds'],
  ['run_failed', 'fails'],
  ['run_rejected', 'is rejected'],
]);

const definitionVerbs: ReadonlyMap<string, string> = new Map([
  ['definition_created', 'is created'],
  ['definition_updated', 'is updated'],
  ['definition_retired', 'is retired'],
]);

const definitionSources = '/definitions/';

const playbookCallers = 'playbook:';

function definitionNamed(path: string): Phrases | undefined {
  const slash = path.indexOf('/');
  return slash > 0 && slash < path.length - 1
    ? ['the ', definitionResourceLabel(path.slice(0, slash)), ' ', named(path.slice(slash + 1))]
    : undefined;
}

function runHappening(verb: string, subject: Schema.Json | undefined): Happening {
  if (subject === undefined) {
    return { who: ['a run of any function or workflow'], verb };
  }
  const definition = definitionNamed(valueText(subject));
  return definition === undefined
    ? { who: ['a run'], verb }
    : { who: ['a run of ', ...definition], verb, said: 'subject' };
}

function definitionHappening(verb: string, source: Schema.Json | undefined): Happening {
  if (source === undefined) {
    return { who: ['any function or workflow'], verb };
  }
  const text = valueText(source);
  const definition = text.startsWith(definitionSources)
    ? definitionNamed(text.slice(definitionSources.length))
    : undefined;
  return definition === undefined ? { who: ['a definition'], verb } : { who: definition, verb, said: 'source' };
}

function happeningOf(filter: EventFilter): Happening {
  const runVerb = runVerbs.get(filter.type);
  if (runVerb !== undefined) {
    return runHappening(runVerb, filter['subject']);
  }
  const definitionVerb = definitionVerbs.get(filter.type);
  return definitionVerb === undefined
    ? { who: ['an event ', { code: filter.type }], verb: 'is published to the playbook' }
    : definitionHappening(definitionVerb, filter['source']);
}

function callerPhrases(caller: string): Phrases {
  return caller.startsWith(playbookCallers)
    ? [
        'when the caller is the playbook ',
        { code: caller.slice(playbookCallers.length) },
        ', as for a run a trigger started and the runs it calls',
      ]
    : ['when the caller is ', { code: caller }];
}

function dataPhrases(data: Schema.Json): Phrases {
  const expression = enclosedBody(data);
  return expression === undefined
    ? ['when its data is exactly ', { code: JSON.stringify(data) }]
    : ['when ', { code: expression.trim() }, ' holds for its data'];
}

function conditionPhrases([name, value]: Attribute): Phrases {
  switch (name) {
    case 'source': {
      return ['from the source ', { code: valueText(value) }];
    }
    case 'subject': {
      return ['with the subject ', { code: valueText(value) }];
    }
    case 'caller': {
      return callerPhrases(valueText(value));
    }
    case 'data': {
      return dataPhrases(value);
    }
    default: {
      return ['when its ', { code: name }, ' is ', { code: valueText(value) }];
    }
  }
}

export function eventFilterPhrases(filter: EventFilter): Phrases {
  const { who, verb, said } = happeningOf(filter);
  const conditions = Object.entries(filter)
    .filter(([name]: Attribute) => name !== 'type' && name !== said)
    .map((attribute: Attribute) => conditionPhrases(attribute));
  const phrases: Phrase[] = [...who, ` ${verb}`];
  for (const [index, condition] of conditions.entries()) {
    phrases.push(index === 0 ? ', ' : ' and ', ...condition);
  }
  return phrases;
}
