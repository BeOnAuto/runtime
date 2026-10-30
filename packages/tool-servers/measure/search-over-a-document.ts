import { serveOnLoopback } from '../src/testing/loopback-server.ts';
import { playbookToolCalls } from '../src/testing/playbook-tool-calls.ts';
import { describedAccess } from '../src/testing/reporting-access.ts';

const operations = 500;

const searchesMeasured = 500;

const searchesToWarm = 50;

const nouns = [
  'invoice',
  'customer',
  'payment',
  'refund',
  'order',
  'shipment',
  'product',
  'contract',
  'ticket',
  'report',
];

const verbs = ['list', 'get', 'create', 'update', 'archive'];

function operationAt(index: number): readonly [string, unknown] {
  const noun = String(nouns[index % nouns.length]);
  const verb = String(verbs[Math.floor(index / nouns.length) % verbs.length]);
  return [
    `/${noun}s/${String(index)}`,
    {
      get: {
        operationId: `${verb}${noun.charAt(0).toUpperCase()}${noun.slice(1)}${String(index)}`,
        summary: `The ${noun} operation ${String(index)}, which ${verb}s the ${noun}s of an account by its region and date.`,
        parameters: [
          { name: `${noun}_id`, in: 'query', schema: { type: 'string' } },
          { name: 'region', in: 'query', schema: { type: 'string' } },
        ],
      },
    },
  ];
}

const document = {
  openapi: '3.1.0',
  info: { title: 'Wide', version: '1' },
  servers: [{ url: 'https://wide.example.com' }],
  paths: Object.fromEntries(Array.from({ length: operations }, (_, index) => operationAt(index))),
};

interface Measured {
  readonly medianMs: number;
  readonly p95Ms: number;
}

function measuredOf(durations: readonly number[]): Measured {
  const sorted = durations.toSorted((first, second) => first - second);
  const at = (share: number) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]);
  return { medianMs: at(0.5), p95Ms: at(0.95) };
}

function durationsOf(times: number, call: () => Promise<unknown>): Promise<readonly number[]> {
  const durations: number[] = [];
  const next = async (): Promise<readonly number[]> => {
    if (durations.length === times) {
      return durations;
    }
    const began = performance.now();
    await call();
    durations.push(performance.now() - began);
    return next();
  };
  return next();
}

function shown({ medianMs, p95Ms }: Measured): string {
  return `median ${medianMs.toFixed(3)} ms, p95 ${p95Ms.toFixed(3)} ms`;
}

const served = await serveOnLoopback(() => () => Promise.resolve(Response.json(document)));
const { access } = await describedAccess({ wide: { document: `${served.origin}/openapi.json`, org: 'acme' } });
const { call } = playbookToolCalls(access);
const byTerms = () => call('search', { terms: 'refund region' });
const whole = () => call('search', {});

await durationsOf(searchesToWarm, byTerms);
await durationsOf(searchesToWarm, whole);
const searchedByTerms = measuredOf(await durationsOf(searchesMeasured, byTerms));
const searchedWhole = measuredOf(await durationsOf(searchesMeasured, whole));

console.log(
  `${String(searchesMeasured)} searches of a document of ${String(operations)} operations, each measured after ${String(searchesToWarm)} to warm up`,
);
console.log(`with two terms, 100 tools answered: ${shown(searchedByTerms)}`);
console.log(`without terms, the server alone:    ${shown(searchedWhole)}`);

await access.close();
await served.close();
