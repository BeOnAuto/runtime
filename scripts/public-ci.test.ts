import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');

const StepSchema = Schema.Struct({
  uses: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const JobSchema = Schema.Struct({
  if: Schema.optionalKey(Schema.String),
  needs: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  permissions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  strategy: Schema.optionalKey(
    Schema.Struct({
      matrix: Schema.Struct({ include: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
    }),
  ),
  steps: Schema.Array(StepSchema),
});

const workflowOf = Schema.decodeUnknownSync(
  Schema.Struct({
    on: Schema.Record(Schema.String, Schema.Unknown),
    env: Schema.Record(Schema.String, Schema.String),
    concurrency: Schema.Struct({ group: Schema.String, 'cancel-in-progress': Schema.Unknown }),
    jobs: Schema.Record(Schema.String, JobSchema),
  }),
);

const releaseWorkflowOf = Schema.decodeUnknownSync(
  Schema.Struct({
    on: Schema.Record(Schema.String, Schema.Unknown),
    jobs: Schema.Record(Schema.String, JobSchema),
  }),
);

type Job = typeof JobSchema.Type;
type Step = typeof StepSchema.Type;
type Jobs = Readonly<Record<string, Job>>;

const ci = workflowOf(parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')));
const release = releaseWorkflowOf(parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')));

function jobOf(jobs: Jobs, name: string): Job {
  const job = jobs[name];
  if (job === undefined) throw new Error(`The workflow has no job ${name}`);
  return job;
}

function needsOf(job: Job): readonly string[] {
  if (job.needs === undefined) return [];
  return typeof job.needs === 'string' ? [job.needs] : job.needs;
}

function conditionOf(job: Job): string {
  return job.if ?? '';
}

function scriptsOf(job: Job): string {
  return job.steps.map(({ run = '' }) => run).join('\n');
}

function architecturesOf(job: Job): readonly unknown[] {
  return (job.strategy?.matrix.include ?? []).map(({ architecture }) => architecture);
}

function environmentOf(step: Step | undefined, name: string): unknown {
  return step?.env?.[name];
}

const smokeHelpers = new Set(['calls.sh', 'runtime.sh', 'npm-package.sh']);

const imageSmokes = readdirSync(join(root, '.github/smoke'))
  .filter((file) => file.endsWith('.sh') && !smokeHelpers.has(file))
  .map((file) => file.slice(0, -'.sh'.length));

function cachedIn(job: Job): readonly string[] {
  return job.steps.flatMap(({ uses = '', run = '', with: given = {} }) => [
    ...(uses.startsWith('actions/cache') ? [uses] : []),
    ...(/\bturbo\b/u.test(run) ? [run] : []),
    ...Object.keys(given).filter((key) => key.startsWith('cache-')),
  ]);
}

function turboRunsOf(jobs: Jobs): readonly string[] {
  return Object.values(jobs)
    .flatMap(({ steps }) => steps)
    .map(({ run = '' }) => run)
    .filter((run) => /\bturbo run\b/u.test(run));
}

function alertStepOf(jobs: Jobs): Step | undefined {
  return jobOf(jobs, 'alert').steps.find(({ run }) => run === '.github/alert/main.sh');
}

await test('CI runs on every push to main, on pull requests and by hand', () => {
  assert.deepEqual(ci.on['push'], { branches: ['main'] });
  assert.ok('pull_request' in ci.on);
  assert.ok('workflow_dispatch' in ci.on);
});

await test('no run of CI on a push is cancelled or replaced by a later push, so every commit on main is checked', () => {
  assert.equal(ci.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.match(ci.concurrency.group, /github\.event_name == 'push' && github\.sha/u);
});

await test('the container job builds the image for amd64 and arm64 and runs every smoke against it', () => {
  const container = jobOf(ci.jobs, 'container');
  assert.deepEqual(architecturesOf(container), ['amd64', 'arm64']);
  assert.ok(container.steps.some(({ uses = '' }) => uses.startsWith('docker/build-push-action@')));
  assert.ok(imageSmokes.length >= 13);
  const scripts = scriptsOf(container);
  assert.deepEqual(
    imageSmokes.filter((smoke) => !scripts.includes(`.github/smoke/${smoke}.sh `)),
    [],
  );
});

await test('the package job packs the npm package and runs it with npx outside the repository', () => {
  const scripts = scriptsOf(jobOf(ci.jobs, 'package'));
  assert.match(scripts, /pnpm --filter @on\.auto\/server npm:pack/u);
  assert.match(scripts, /\.github\/smoke\/npm-package\.sh/u);
});

await test('the smokes, the image build, the npm package and the AWS checks never come from a cache', () => {
  assert.deepEqual(
    ['container', 'package', 'secrets-aws'].flatMap((name) => cachedIn(jobOf(ci.jobs, name))),
    [],
  );
});

await test('outside a pull request every task turbo runs is run again, never replayed from a cache', () => {
  assert.equal(ci.env['UNCACHED'], "${{ github.event_name != 'pull_request' && github.event_name != 'merge_group' }}");
  const runs = turboRunsOf(ci.jobs);
  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs.filter((run) => !/if \[ "\$UNCACHED" = true \]; then\n\s+\w+\+?=\(--force\)/u.test(run)),
    [],
  );
});

await test('ci-ok needs every job that checks the runtime', () => {
  const required = new Set(['ci-ok', 'alert', ...needsOf(jobOf(ci.jobs, 'ci-ok'))]);
  assert.deepEqual(
    Object.keys(ci.jobs).filter((name) => !required.has(name)),
    [],
  );
});

await test('a run of CI on main that fails, or passes after one failed, alerts by issue and by the webhook', () => {
  const alert = jobOf(ci.jobs, 'alert');
  const step = alertStepOf(ci.jobs);
  assert.deepEqual(needsOf(alert), ['ci-ok']);
  assert.match(conditionOf(alert), /^\$\{\{ !cancelled\(\) && github\.ref == 'refs\/heads\/main'/u);
  assert.equal(alert.permissions?.['issues'], 'write');
  assert.equal(environmentOf(step, 'WORKFLOW'), 'CI');
  assert.equal(environmentOf(step, 'OUTCOME'), '${{ needs.ci-ok.result }}');
  assert.equal(environmentOf(step, 'ALERT_WEBHOOK_URL'), '${{ secrets.CI_ALERT_WEBHOOK_URL }}');
  assert.equal(environmentOf(step, 'ASSIGNEES'), '${{ vars.CI_ALERT_ASSIGNEES }}');
});

await test('a release publishes nothing until CI passed on its commit', () => {
  assert.deepEqual(needsOf(jobOf(release.jobs, 'checked')), ['release-please']);
  assert.match(scriptsOf(jobOf(release.jobs, 'checked')), /--commit "\$GITHUB_SHA" --workflow ci\.yml --event push/u);
  assert.ok(needsOf(jobOf(release.jobs, 'platform-image')).includes('checked'));
  assert.ok(needsOf(jobOf(release.jobs, 'package')).includes('checked'));
  assert.ok(needsOf(jobOf(release.jobs, 'image')).includes('platform-image'));
});

await test('a release run that fails, or passes after one failed, alerts by issue and by the webhook', () => {
  const alert = jobOf(release.jobs, 'alert');
  const step = alertStepOf(release.jobs);
  const watched = new Set(['alert', ...needsOf(alert)]);
  assert.deepEqual(
    Object.keys(release.jobs).filter((name) => !watched.has(name)),
    [],
  );
  assert.match(conditionOf(alert), /^\$\{\{ !cancelled\(\) \}\}$/u);
  assert.equal(alert.permissions?.['issues'], 'write');
  assert.equal(environmentOf(step, 'WORKFLOW'), 'Release');
  assert.equal(environmentOf(step, 'ALERT_WEBHOOK_URL'), '${{ secrets.CI_ALERT_WEBHOOK_URL }}');
  assert.equal(environmentOf(step, 'ASSIGNEES'), '${{ vars.CI_ALERT_ASSIGNEES }}');
});
