import type { ConflictKind } from '../outcome/conflict.ts';
import type { Explanation } from './plain-language.ts';

type ConflictOfAMove = Extract<
  ConflictKind,
  'incomplete' | 'in_use' | 'runs_in_progress' | 'connection_not_accessible'
>;

export function moveExplanationsAs(notFitting: Explanation): Readonly<Record<ConflictOfAMove, Explanation>> {
  return {
    incomplete: notFitting,
    in_use: notFitting,
    runs_in_progress: {
      why: 'a run that has not ended is in the way',
      remedy: 'It can be tried again once the runs the details name have ended or been cancelled.',
    },
    connection_not_accessible: {
      why: 'the other playbook has no access to a connection one of them needs',
      remedy: 'The details below say which connection, and what the person can choose.',
    },
  };
}
