import { globSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import type { UserConfig } from '@commitlint/types';

const workspaceScopes = [
  ...new Set(
    globSync(['{packages,capabilities}/*/package.json', '{packages,capabilities}/*/README.md'], {
      cwd: import.meta.dirname,
    }).map((file) => basename(dirname(file))),
  ),
];

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...workspaceScopes, 'global', 'deps', 'ci', 'release']],
  },
} satisfies UserConfig;
