import { sessionRowsBehaviour } from './session-rows-behaviour.ts';
import { sessionRowsInMemory } from './session-rows-in-memory.ts';

sessionRowsBehaviour({ name: 'in memory', rowsOf: () => Promise.resolve(sessionRowsInMemory()) });
