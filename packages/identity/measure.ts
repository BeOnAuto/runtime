import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';

import { identityServiceOf, type IdentityService } from './src/index.ts';
import { fakeIssuer, hostedStudio, principalIn, type FakeIssuer, type FakeSigner } from './src/testing/index.ts';

const publicUrl = 'https://runtime.example';

const starts = 200;

const verifications = 10_000;

const signers: readonly FakeSigner[] = ['RS256', 'PS256', 'ES256', 'EdDSA'];

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function startOf(fake: FakeIssuer): Promise<IdentityService> {
  return identityServiceOf(
    { issuer: fake.issuer, publicUrl, studio: hostedStudio, allowedOrigins: [] },
    { fetch: fake.answer, now: Date.now },
  );
}

async function startsIn(fake: FakeIssuer, left: number, times: readonly number[]): Promise<readonly number[]> {
  if (left === 0) {
    return times;
  }
  const started = performance.now();
  await startOf(fake);
  return startsIn(fake, left - 1, [...times, performance.now() - started]);
}

function median(times: readonly number[]): number {
  return times.toSorted((one, other) => one - other)[Math.floor(times.length / 2)] ?? 0;
}

async function admitted(identityService: IdentityService, token: string): Promise<void> {
  if (principalIn(await identityService.personOf(token, '/mcp'))?.callerIn('acme') === undefined) {
    throw new Error('A token the measurement signed was refused');
  }
}

async function verifiedIn(identityService: IdentityService, token: string, left: number): Promise<number> {
  const started = performance.now();
  await Array.from({ length: left }).reduce<Promise<void>>(
    (previous) => previous.then(() => admitted(identityService, token)),
    Promise.resolve(),
  );
  return ((performance.now() - started) * 1000) / left;
}

async function verificationsBy(
  identityService: IdentityService,
  fake: FakeIssuer,
  rest: readonly FakeSigner[],
): Promise<void> {
  const [signer, ...others] = rest;
  if (signer === undefined) {
    return;
  }
  const seconds = Math.floor(Date.now() / 1000);
  const token = await fake.sign(
    { iss: fake.issuer, sub: 'ada', aud: publicUrl, iat: seconds, exp: seconds + 3600, org_id: 'acme' },
    { signer },
  );
  write(
    `  ${signer}: ${(await verifiedIn(identityService, token, verifications)).toFixed(1)} µs per request, one after another`,
  );
  await verificationsBy(identityService, fake, others);
}

async function measured(run: number): Promise<void> {
  const fake = fakeIssuer('https://login.example');
  write(`Run ${run}`);
  write(
    `  start, its metadata and a key set of ${signers.length} keys read: ${median(await startsIn(fake, starts, [])).toFixed(2)} ms, the median of ${starts}`,
  );
  await verificationsBy(await startOf(fake), fake, signers);
}

write(`Node ${process.version}, ${availableParallelism()} cores`);
await measured(1);
await measured(2);
