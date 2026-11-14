import { compositionRootWith } from '../../composition/composition-root.ts';
import { loggedModelAccess } from '../../composition/served-reasoning.ts';

/** The composition of the shipped server with goals left out, for a test whose subject is not goals. */
export const compositionRootWithoutGoals = compositionRootWith(loggedModelAccess, { goals: false });
