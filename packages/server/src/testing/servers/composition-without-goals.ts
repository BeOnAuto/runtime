import { compositionRootWith } from '../../composition/composition-root.ts';
import { loggedModelAccess } from '../../composition/served-reasoning.ts';

/** The composition of the shipped server with goals left out, for a child process a test spawns: it runs on its own clock. */
export const compositionRootWithoutGoals = compositionRootWith(loggedModelAccess, { goals: false });
