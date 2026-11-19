import { describe, expect, it } from 'vitest';

import { Conflict } from '../outcome/conflict.ts';
import { namesReadAtThePort } from './names-reads-behaviour.ts';
import {
  answerOf,
  answerOfSeveral,
  bounded,
  fact,
  heldNames,
  made,
  shared,
  taken,
  unbounded,
  versionOf,
  type NamesAtThePortEntry,
} from './noted-names.ts';

export type { NamesAtThePort, NamesAtThePortEntry } from './noted-names.ts';

function claimedOnce(entry: NamesAtThePortEntry): void {
  it('keeps the name a definition claims, and refuses one another holds with the conflict, keeping nothing of the append', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'));

    const refused = await answerOf(port, shared, made('b', 'triage'), fact('remarked', '-'));

    expect(refused).toEqual(taken('triage', 'active'));
    expect(await versionOf(port, shared)).toBe(1);
    expect(await heldNames(port)).toEqual(['a alpha/reasoning/triage active']);
  });

  it('holds a name unique among the definitions of its type in its playbook alone, and claims none for a fact of no definition', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'));

    const answers = [
      await answerOf(port, shared, made('b', 'triage', { type: 'workflow' })),
      await answerOf(port, shared, made('c', 'triage', { playbook: 'beta' })),
      await answerOf(port, shared, fact('made', 'triage')),
      await answerOf(port, shared, fact('renamed', 'loose', { definition: 'z' })),
    ];

    expect(answers).toEqual([null, null, null, null]);
    expect(await heldNames(port)).toEqual([
      'a alpha/reasoning/triage active',
      'b alpha/workflow/triage active',
      'c beta/reasoning/triage active',
    ]);
  });
}

function changes(entry: NamesAtThePortEntry): void {
  it('frees a name given up or released at once, keeps a retired one, and judges a whole append as one change', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'), made('b', 'brief'), made('c', 'old'));

    const answers = [
      await answerOf(
        port,
        shared,
        fact('renamed', 'brief', { definition: 'a' }),
        fact('renamed', 'triage', { definition: 'b' }),
      ),
      await answerOf(port, shared, fact('forgotten', '-', { definition: 'c' }), made('d', 'old')),
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'd' })),
      await answerOf(port, shared, made('e', 'old')),
    ];

    expect(answers).toEqual([null, null, null, taken('old', 'retired')]);
    expect(await heldNames(port)).toEqual([
      'a alpha/reasoning/brief active',
      'b alpha/reasoning/triage active',
      'd alpha/reasoning/old retired',
    ]);
  });

  it('answers one of two claims made at once on one name and refuses the other as taken', async () => {
    const port = await entry.keeping(unbounded);

    const answers = await Promise.all([
      answerOf(port, `${shared}-one`, made('a', 'triage')),
      answerOf(port, `${shared}-two`, made('b', 'triage')),
    ]);

    expect(answers.filter((answer) => answer !== null)).toEqual([taken('triage', 'active')]);
    expect(await port.names()).toHaveLength(1);
  });
}

function bounds(entry: NamesAtThePortEntry): void {
  it('refuses a checked fact that leaves more counted than a bound, with the count before, in the order the bounds are declared', async () => {
    const port = await entry.keeping(bounded);
    await answerOf(port, shared, made('a', 'triage', { starts: true }), made('b', 'brief'));

    const answers = [
      await answerOf(port, shared, made('c', 'review')),
      await answerOf(port, shared, fact('renamed', 'digest', { definition: 'b', starts: true })),
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'b' })),
      await answerOf(port, shared, made('c', 'review')),
    ];

    expect(answers).toEqual([
      new Conflict({ detail: 'review made: 2 of 2' }),
      new Conflict({ detail: 'digest renamed: 1 starting of 1' }),
      null,
      null,
    ]);
    expect(await port.names()).toHaveLength(3);
  });

  it('keeps one of two appends made at once that each add the last definition a bound allows, and refuses the other with the bound', async () => {
    const port = await entry.keeping(bounded);
    await answerOf(port, shared, made('a', 'triage'));

    const answers = await Promise.all([
      answerOf(port, `${shared}-one`, made('b', 'brief')),
      answerOf(port, `${shared}-two`, made('c', 'review')),
    ]);

    const [refused, ...more] = answers.filter((answer) => answer !== null);
    expect(more).toEqual([]);
    expect([
      new Conflict({ detail: 'brief made: 2 of 2' }),
      new Conflict({ detail: 'review made: 2 of 2' }),
    ]).toContainEqual(refused);
    expect(await port.names()).toHaveLength(2);
  });
}

const another = 'playbook/acme/alpha/definitions/workflow';

function severalStreams(entry: NamesAtThePortEntry): void {
  it('keeps the facts of several streams decided together, judging their names as one append', async () => {
    const port = await entry.keeping(unbounded);
    await answerOfSeveral(port, [
      [shared, [made('a', 'triage')]],
      [another, [made('b', 'brief')]],
    ]);

    const swapped = await answerOfSeveral(port, [
      [another, [fact('renamed', 'triage', { definition: 'b' })]],
      [shared, [fact('renamed', 'brief', { definition: 'a' })]],
    ]);

    expect(swapped).toEqual([2, 2]);
    expect(await heldNames(port)).toEqual(['a alpha/reasoning/brief active', 'b alpha/reasoning/triage active']);
  });

  it('keeps nothing of any stream when the names refuse the fact of one of them, and answers that refusal', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'));

    const refused = await answerOfSeveral(port, [
      [another, [made('b', 'brief')]],
      [shared, [made('c', 'triage')]],
    ]);

    expect(refused).toEqual(taken('triage', 'active'));
    expect([await versionOf(port, shared), await versionOf(port, another)]).toEqual([1, 0]);
    expect(await heldNames(port)).toEqual(['a alpha/reasoning/triage active']);
  });
}

export function namesAtThePortBehaviour(entry: NamesAtThePortEntry): void {
  describe('the names of definitions, judged at the port', () => {
    claimedOnce(entry);
    changes(entry);
    bounds(entry);
    severalStreams(entry);
  });
  namesReadAtThePort(entry);
}
