import { describe, expect, it } from 'vitest';

import { describeIssues } from './issues.ts';

const listed = (keys: readonly PropertyKey[]): string => keys.map(String).join('/');

describe('describeIssues', () => {
  it('names each issue by the keys of its path, whether they are plain keys or path segments', () => {
    const failure = {
      issues: [
        { message: 'Missing key', path: ['keys', 0, 'org'] },
        { message: 'Expected string', path: [{ key: 'keys' }, { key: 1 }] },
        { message: 'Key ids must be unique' },
      ],
    };

    expect(describeIssues(failure, listed)).toBe(
      'keys/0/org: Missing key; keys/1: Expected string; : Key ids must be unique',
    );
  });
});
