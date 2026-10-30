import { Conflict } from '@on.auto/operations';

export const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with list_playbook_events, given its run id, what it called',
  kind: 'tools_called',
});

export const toolsOnlyRead = new Conflict({
  detail:
    "The run called tools and did not succeed, so it is not run again under its id; every tool it called only reads, by its server's own account, so nothing was changed: start a new run with another run id, and read with list_playbook_events, given its run id, what it called",
  kind: 'tools_called',
  because: 'only_read',
});

export const startedCallingTools = new Conflict({
  detail:
    'The run has started and its definition calls tools, so it is not run again under its id: it may still be in progress, or have stopped without recording how it ended, and its tools may have changed something; start a new run with another run id, and read with list_playbook_events, given its run id, what it has called so far',
  kind: 'tools_called',
});
