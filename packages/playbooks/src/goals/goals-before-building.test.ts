import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { beforeBuildingAfterAgreeOf, playbookOperationsOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory } from '../testing/goals-in-memory.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, restatedGoalsText } from '../testing/index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const toAcme = toOrg('acme');

const untilTheYes =
  'Stop here: show the person its goals through the studio link and change them with update_playbook until they say yes to them as saved; build no function or workflow before that yes.';

const untilTheNewYes =
  'Stop here: show the person the goals as saved now and change them with update_playbook until they say yes to them; build no function or workflow before that yes.';

const unsent =
  'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.';

const Answered = Schema.Struct({ output: Schema.Struct({ before_building: Schema.optionalKey(Schema.String) }) });

async function answersWhere(messages: boolean) {
  const pages = pagesInMemory();
  const operations = playbookOperationsOf(pages, goalsInMemory(pages, messages));
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  const { call } = harness();
  const updated = (input: object) => call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', ...input }));
  const created = await createdWithGoals({ call }, named('create_playbook'));
  const changed = await updated({ goals: restatedGoalsText });
  const same = await updated({ goals: restatedGoalsText });
  const renamed = await updated({ name: 'Beta' });
  const read = await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }));
  return [created, changed, same, renamed, read].map(
    (answer) => Schema.decodeUnknownSync(Answered)(answer).output.before_building,
  );
}

describe('before_building in the answers that save goals', () => {
  it('says to stop for the yes after a create and a change, and nothing after a save that changes nothing, a rename or a read', async () => {
    expect(await answersWhere(true)).toEqual([untilTheYes, untilTheNewYes, undefined, undefined, undefined]);
  });

  it('adds, with messages off, that Auto sends no goal messages, after every save of goals', async () => {
    expect(await answersWhere(false)).toEqual([
      `${untilTheYes} ${unsent}`,
      `${untilTheNewYes} ${unsent}`,
      unsent,
      undefined,
      undefined,
    ]);
  });

  it('says, after a yes, only with messages off that Auto sends no goal messages', () => {
    expect([beforeBuildingAfterAgreeOf(false), beforeBuildingAfterAgreeOf(true)]).toEqual([unsent, undefined]);
  });

  it('is described in the output schemas of create_playbook and update_playbook', () => {
    const pages = pagesInMemory();
    const described = playbookOperationsOf(pages, goalsInMemory(pages))
      .filter(({ registration }) => JSON.stringify(registration.output).includes('"before_building"'))
      .map(({ registration }) => registration.name);

    expect(described).toEqual(['create_playbook', 'get_playbook', 'update_playbook']);
  });
});
