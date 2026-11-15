import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

interface Alerted {
  readonly status: number | null;
  readonly output: string;
  readonly calls: readonly string[];
  readonly posted: readonly string[];
}

function linesOf(path: string): readonly string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
}

function alerted(outcome: string, openIssues: string, webhook: string, assignees = ''): Alerted {
  const folder = mkdtempSync(join(tmpdir(), 'alert-'));
  const calls = join(folder, 'calls');
  const posted = join(folder, 'posted');
  const issues = join(folder, 'issues.json');
  writeFileSync(issues, openIssues);
  writeFileSync(
    join(folder, 'gh'),
    [
      '#!/usr/bin/env bash',
      'all="$*"',
      `printf '%s\\n' "\${all//$'\\n'/ }" >> "${calls}"`,
      `if [ "$1 $2" = 'issue list' ]; then cat "${issues}"; fi`,
      `if [ "$1 $2" = 'issue create' ] && [[ "$all" == *--assignee* ]] && [ "$ASSIGNEES" = nobody ]; then exit 1; fi`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(folder, 'curl'),
    ['#!/usr/bin/env bash', `cat >> "${posted}"`, `printf '%s\\n' "\${@: -1}" >> "${posted}"`, ''].join('\n'),
  );
  chmodSync(join(folder, 'gh'), 0o755);
  chmodSync(join(folder, 'curl'), 0o755);
  const result = spawnSync('bash', [join(root, '.github/alert/main.sh')], {
    encoding: 'utf8',
    env: {
      PATH: `${folder}:${process.env['PATH'] ?? ''}`,
      OUTCOME: outcome,
      WORKFLOW: 'CI',
      GH_REPO: 'example/runtime',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      RUN_URL: 'https://github.com/example/runtime/actions/runs/1',
      ASSIGNEES: assignees,
      ALERT_WEBHOOK_URL: webhook,
    },
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls: linesOf(calls),
    posted: linesOf(posted),
  };
}

const ourIssue = JSON.stringify([
  { number: 7, title: 'CI fails on main', author: { login: 'someone', is_bot: false } },
  { number: 9, title: 'CI fails on main', author: { login: 'app/github-actions', is_bot: true } },
]);

const webhook = 'https://alerts.example/hook';

await test('a first failure on main opens the issue, assigned when assignees are set, and posts to the webhook', () => {
  const { status, calls, posted } = alerted('failure', '[]', webhook, 'maintainer');
  assert.equal(status, 0);
  assert.equal(calls.length, 2);
  assert.match(
    calls.join('\n'),
    /\nissue create --repo example\/runtime --title CI fails on main --body CI failed on main at 0123456789abcdef.* --assignee maintainer$/u,
  );
  assert.deepEqual(posted, [
    JSON.stringify({
      text: 'example/runtime: CI failed on main at 0123456789ab. https://github.com/example/runtime/actions/runs/1',
    }),
    webhook,
  ]);
});

await test('an issue is opened unassigned when the assignees cannot be assigned', () => {
  const { status, calls } = alerted('failure', '[]', '', 'nobody');
  assert.equal(status, 0);
  assert.equal(calls.filter((call) => call.startsWith('issue create')).length, 2);
  assert.doesNotMatch(calls.join('\n'), /--assignee nobody$/u);
});

await test('a further failure adds to the open issue the workflow opened, not to one a person opened', () => {
  const { status, calls, posted } = alerted('failure', ourIssue, webhook);
  assert.equal(status, 0);
  assert.match(calls.join('\n'), /\nissue comment 9 --repo example\/runtime --body CI failed again at /u);
  assert.equal(posted.length, 2);
});

await test('with no webhook the issue is the only alert', () => {
  const { status, output, posted } = alerted('failure', '[]', '');
  assert.equal(status, 0);
  assert.deepEqual(posted, []);
  assert.match(output, /CI_ALERT_WEBHOOK_URL is not set/u);
});

await test('a pass after a failure closes the issue and posts the recovery', () => {
  const { status, calls, posted } = alerted('success', ourIssue, webhook);
  assert.equal(status, 0);
  assert.match(calls.join('\n'), /\nissue close 9 --repo example\/runtime --comment CI passes on main again at /u);
  assert.match(posted.join('\n'), /^\{"text":"example\/runtime: CI passes on main again at 0123456789ab\. /u);
});

await test('a pass with no open issue says nothing', () => {
  const { status, calls, posted } = alerted('success', '[]', webhook);
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(posted, []);
});
