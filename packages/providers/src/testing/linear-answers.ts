/** The account a Linear connection acts as, made up, and another person in its workspace. */
export const theConnectedAccount = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

export const someoneElse = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

/** What Linear's `whoami` answers, made up in its shape: the account the connection acts as, and its workspace. */
export const aWhoAmIAnswer = {
  user: { id: theConnectedAccount, name: 'Grace Hopper', displayName: 'grace' },
  workspace: { id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', name: 'Acme', url: 'https://linear.app/acme' },
};

export const anIssue = {
  id: 'ENG-123',
  uuid: '0b7f6c1e-5d2a-4c3b-9e8f-1a2b3c4d5e6f',
  title: 'The export button does nothing',
  url: 'https://linear.app/acme/issue/ENG-123/the-export-button-does-nothing',
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:40:00.000Z',
  completedAt: null,
  status: 'In Progress',
  statusType: 'started',
  priority: { value: 2, name: 'High' },
  assignee: 'Ada Lovelace',
  team: 'Engineering',
  createdById: theConnectedAccount,
};

export const aCompletedIssue = {
  ...anIssue,
  id: 'ENG-122',
  uuid: '9c8d7e6f-1a2b-4c3d-8e5f-6a7b8c9d0e1f',
  title: 'Dates show in the wrong time zone',
  url: 'https://linear.app/acme/issue/ENG-122/dates-show-in-the-wrong-time-zone',
  createdAt: '2026-11-19T15:00:00.000Z',
  updatedAt: '2026-11-20T09:30:00.000Z',
  completedAt: '2026-11-20T09:30:00.000Z',
  status: 'Done',
  statusType: 'completed',
  priority: { value: 0, name: 'No priority' },
  assignee: null,
  createdById: someoneElse,
};

/** A page of what Linear's `list_issues` answers, made up in its shape: newest first, and the next page's token. */
export const aPage = { issues: [anIssue, aCompletedIssue], hasNextPage: true, cursor: aCompletedIssue.uuid };

/** The last page, which names no next page. */
export const theLastPage = { issues: [], hasNextPage: false };
