import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { workflow } from '../testing/workflows.ts';
import type { JsonObject } from './json.ts';
import type { Rejection } from './policy-checks.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

function rejectedIn(tasks: string): readonly string[] {
  return rejectionsOf(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

function refusingReserved(attributes: JsonObject, pointer: string): readonly Rejection[] {
  return attributes['type'] === 'reserved'
    ? [{ pointer: `${pointer}/type`, detail: 'reserved', forbidden: false }]
    : [];
}

describe('the policy of the tasks of a document', () => {
  it('rejects run tasks, and a task with no type', () => {
    expect(
      rejectedIn(`
  - shell: { run: { shell: { command: ls } } }
  - dance: { tango: true }
`),
    ).toEqual([
      '/do/0/shell/run: run tasks (shell, script, container, workflow) are not allowed',
      '/do/1/dance: The task has no type this runtime knows',
    ]);
  });
});

describe('the policy of an emit task', () => {
  it('takes an emit of an event with a type and a source, and rejects one without either, with an id, or with nothing', () => {
    expect(
      rejectedIn(`
  - announce: { emit: { event: { with: { type: com.acme.done, source: /acme, data: '\${ $data.total }' } } } }
  - typeless: { emit: { event: { with: { source: /acme } } } }
  - sourceless: { emit: { event: { with: { type: com.acme.done } } } }
  - named: { emit: { event: { with: { type: com.acme.done, source: /acme, id: e1 } } } }
  - empty: { emit: { event: {} } }
  - plain: { emit: 3 }
  - eventless: { emit: { event: 3 } }
`),
    ).toEqual([
      '/do/1/typeless/emit/event/with/type: The event to emit needs a type',
      '/do/2/sourceless/emit/event/with/source: The event to emit needs a source',
      '/do/3/named/emit/event/with/id: An emitted event takes no id: the runtime gives it one of its own, so that a run that resumes emits it once',
      '/do/4/empty/emit: emit takes event.with, a mapping of the attributes of the event to emit',
      '/do/5/plain/emit: emit takes event.with, a mapping of the attributes of the event to emit',
      '/do/6/eventless/emit: emit takes event.with, a mapping of the attributes of the event to emit',
    ]);
  });

  it('asks the functions it is given what more an emitted event may not be', () => {
    const refusing = policyOf({ ...testFunctions, emitRejections: refusingReserved });

    expect(
      refusing(workflow('do:\n  - announce: { emit: { event: { with: { type: reserved, source: /acme } } } }')),
    ).toEqual([{ pointer: '/do/0/announce/emit/event/with/type', detail: 'reserved', forbidden: false }]);
  });
});

describe('the policy of a call', () => {
  it.each(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp'])('rejects call: %s', (name) => {
    expect(rejectedIn(`  - fetch: { call: ${name}, with: {} }`)).toEqual([
      `/do/0/fetch/call: call: ${name} is not allowed: a workflow reaches the world only through the functions it is given; call notify`,
    ]);
  });

  it('rejects a call of a function other than those its caller gives', () => {
    const twoFunctions = policyOf({ ...testFunctions, argumentChecks: { notify: () => [], page: () => [] } });

    expect(rejectedIn('  - log: { call: log, with: {} }')).toEqual([
      '/do/0/log/call: call: log names no function; the one function is notify',
    ]);
    expect(twoFunctions(workflow('do:\n  - log: { call: log }')).map(({ detail }) => detail)).toEqual([
      'call: log names no function; the functions are notify, page',
    ]);
  });

  it('names a call through the description its caller gives, for the messages a call raises', () => {
    expect(testFunctions.describe('notify', { to: 'ops' })).toBe('the function notify');
  });

  it('leaves the arguments of a call to the checks of its function', () => {
    expect(
      rejectedIn(`
  - fine: { call: notify, with: { to: '\${ $data.who }' } }
  - bare: { call: notify }
`),
    ).toEqual(['/do/1/bare/with: notify takes with: { to }']);
  });
});

describe('the policy of listen', () => {
  it('takes one, all or any events by their attributes', () => {
    expect(
      rejectedIn(`
  - one: { listen: { to: { one: { with: { type: approved } } } } }
  - all: { listen: { to: { all: [{ with: { type: a } }, { with: { type: b } }] }, read: envelope } }
  - any: { listen: { to: { any: [{ with: { data: '\${ $data.ok }' } }] } } }
`),
    ).toEqual([]);
  });

  it('rejects until, foreach and correlation', () => {
    expect(
      rejectedIn(`
  - until: { listen: { to: { any: [], until: $data.done } } }
  - each: { listen: { to: { one: { with: { type: a } } } }, foreach: { do: [] } }
  - correlated: { listen: { to: { all: [{ with: { type: a }, correlate: { id: { from: $data.id } } }, 3] } } }
`),
    ).toEqual([
      '/do/0/until/listen/to/until: listen until is not supported in this version',
      '/do/1/each/foreach: listen foreach is not supported in this version',
      '/do/2/correlated/listen/to/all/0/correlate: Correlating events is not supported in this version',
    ]);
  });
});
