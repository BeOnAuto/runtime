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
  'continue-on-error': Schema.optionalKey(Schema.Unknown),
});

const JobSchema = Schema.Struct({
  if: Schema.optionalKey(Schema.String),
  'continue-on-error': Schema.optionalKey(Schema.Unknown),
  needs: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  permissions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  strategy: Schema.optionalKey(
    Schema.Struct({
      matrix: Schema.Struct({
        include: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
        architecture: Schema.optionalKey(Schema.Array(Schema.String)),
        system: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
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
type Row = Readonly<Record<string, unknown>>;

const ci = workflowOf(parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')));

const { engines } = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ engines: Schema.Struct({ node: Schema.String }) })),
)(readFileSync(join(root, 'package.json'), 'utf8'));
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

function crossedArchitecturesOf(job: Job): readonly string[] {
  return job.strategy?.matrix.architecture ?? [];
}

function systemsOf(job: Job): readonly string[] {
  return job.strategy?.matrix.system ?? [];
}

function systemsOnNode(job: Job, node: string): readonly unknown[] {
  return (job.strategy?.matrix.include ?? []).filter((row) => row['node'] === node).map((row) => row['system']);
}

function alpineSystemsOf(job: Job): readonly string[] {
  return systemsOf(job).filter((system) => /^node:[\d.]+-alpine/u.test(system));
}

function agreesWithTheRow(extra: Row, row: Row): boolean {
  return ['architecture', 'system'].every((key) => !(key in extra) || extra[key] === row[key]);
}

function crossedRowsOf(job: Job): readonly Row[] {
  return crossedArchitecturesOf(job).flatMap((architecture) =>
    systemsOf(job).map((system): Row => ({ architecture, system })),
  );
}

function includedRowsOf(job: Job): readonly Row[] {
  return job.strategy?.matrix.include ?? [];
}

function rowsOf(job: Job): readonly Row[] {
  return crossedRowsOf(job).map((row) =>
    Object.fromEntries(
      [row, ...includedRowsOf(job).filter((extra) => agreesWithTheRow(extra, row))].flatMap((part) =>
        Object.entries(part),
      ),
    ),
  );
}

function includedRowsThatAddARow(job: Job): readonly Row[] {
  return includedRowsOf(job).filter((extra) => !crossedRowsOf(job).some((row) => agreesWithTheRow(extra, row)));
}

function rowsThatMayFail(job: Job): readonly (readonly unknown[])[] {
  return rowsOf(job)
    .filter((row) => row['experimental'] === true)
    .map(({ architecture, system }) => [architecture, system]);
}

function jobsAllowedToFail(jobs: Jobs): readonly string[] {
  return Object.keys(jobs).filter((name) => 'continue-on-error' in jobOf(jobs, name));
}

function stepsAllowedToFail(jobs: Jobs): readonly Step[] {
  return Object.values(jobs)
    .flatMap(({ steps }) => steps)
    .filter((step) => 'continue-on-error' in step);
}

function environmentOf(step: Step | undefined, name: string): unknown {
  return step?.env?.[name];
}

const smokeHelpers = new Set(['calls.sh', 'runtime.sh', 'npm-package.sh', 'npm-package-in-container.sh']);

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

await test('the package job packs the npm package and runs it with npx outside the repository, inside a container of each system it names, pinned by digest, on amd64 and arm64', () => {
  const job = jobOf(ci.jobs, 'package');
  const systems = systemsOf(job);
  assert.match(scriptsOf(job), /pnpm --filter @on\.auto\/server npm:pack/u);
  assert.match(scriptsOf(job), /\.github\/smoke\/npm-package-in-container\.sh "\$GITHUB_WORKSPACE" \d+ "\$SYSTEM"/u);
  assert.match(
    readFileSync(join(root, '.github/smoke/npm-package-in-container.sh'), 'utf8'),
    /\.github\/smoke\/npm-package\.sh/u,
  );
  assert.deepEqual(crossedArchitecturesOf(job), ['amd64', 'arm64']);
  assert.ok(systems.length > 0);
  assert.deepEqual(
    systems.filter((system) => !/@sha256:[0-9a-f]{64}$/u.test(system)),
    [],
  );
});

await test('the package job starts the package on the least Node the package allows, on one of the systems it names', () => {
  const job = jobOf(ci.jobs, 'package');
  const systems = systemsOnNode(job, engines.node.replace(/^>=/u, ''));
  assert.equal(systems.length, 1);
  assert.deepEqual(
    systems.filter((system) => !systemsOf(job).includes(String(system))),
    [],
  );
});

await test('the package job lets one row fail without failing CI, Alpine on arm64, which Node does not list, and no other row of any job', () => {
  const job = jobOf(ci.jobs, 'package');
  assert.equal(alpineSystemsOf(job).length, 1);
  assert.deepEqual(includedRowsThatAddARow(job), []);
  assert.deepEqual(rowsThatMayFail(job), [['arm64', ...alpineSystemsOf(job)]]);
  assert.equal(job['continue-on-error'], '${{ matrix.experimental == true }}');
  assert.deepEqual(jobsAllowedToFail(ci.jobs), ['package']);
  assert.deepEqual(stepsAllowedToFail(ci.jobs), []);
});

await test('the smokes, the image build and the npm package never come from a cache', () => {
  assert.deepEqual(
    ['container', 'package'].flatMap((name) => cachedIn(jobOf(ci.jobs, name))),
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
