import { uuidV5 } from '@on.auto/operations';

import { evaluateTemplate } from '../dsl/evaluation.ts';
import { field, isObject, jsonBytesOf, objectField, textField, type JsonObject } from '../dsl/json.ts';
import { RaisedError, raised } from '../dsl/raised-error.ts';
import { callKeyText, type CallKey } from '../executor/call-key.ts';
import { mostEmittedEventSize } from '../machine/limits.ts';
import { isoInstantOf } from '../machine/utc-time.ts';
import { doneOf, type BodyAdvance, type Invocation } from '../runner/advance.ts';

const emittedEvents = '6f0b2c4e-8d1a-5b37-9e62-4a7c3d9f1e85';

export function emittedEventIdOf(key: CallKey): string {
  return uuidV5(emittedEvents, callKeyText(key));
}

function attributesOf(invocation: Invocation): JsonObject {
  const { machine, entry, configuration, input, variables } = invocation;
  const template = field(objectField(isObject(configuration) ? configuration : {}, 'event') ?? {}, 'with');
  const given = evaluateTemplate(template ?? null, input, variables, machine.session.placeAt(entry.reference));
  if (!isObject(given)) {
    throw raised('validation', 400, 'emit takes event.with, a mapping of the attributes of the event', entry.reference);
  }
  return given;
}

function requiredText(attributes: JsonObject, name: string, reference: string): void {
  const value = textField(attributes, name);
  if (value === undefined || value.trim() === '') {
    throw raised('validation', 400, `The event to emit needs a ${name}, text that is not empty`, reference);
  }
}

function checked(attributes: JsonObject, reference: string): void {
  requiredText(attributes, 'type', reference);
  requiredText(attributes, 'source', reference);
  if (field(attributes, 'id') !== undefined) {
    throw raised(
      'validation',
      400,
      'An emitted event takes no id: the runtime gives it one of its own, so that a run that resumes emits it once',
      reference,
    );
  }
}

function eventOf(invocation: Invocation, attributes: JsonObject, key: CallKey): JsonObject {
  const { reference } = invocation.entry;
  const event = {
    ...attributes,
    specversion: '1.0',
    id: emittedEventIdOf(key),
    time: textField(attributes, 'time') ?? isoInstantOf(invocation.machine.session.now),
  };
  const bytes = jsonBytesOf(event);
  if (bytes > mostEmittedEventSize) {
    throw raised(
      'validation',
      400,
      `The event to emit takes ${bytes} bytes as JSON, more than the ${mostEmittedEventSize} an event takes`,
      reference,
    );
  }
  const refusal = invocation.machine.session.options.functions.emitRefusal?.(event);
  if (refusal !== undefined) {
    throw raised('validation', 400, refusal, reference);
  }
  return event;
}

export function startEmit(invocation: Invocation): BodyAdvance {
  const { machine, entry, frame } = invocation;
  const { session } = machine;
  const attributes = attributesOf(invocation);
  checked(attributes, entry.reference);
  const key = { runId: session.runId(), reference: entry.reference, run: frame.run };
  const bound = session.emissions.emit(key, eventOf(invocation, attributes, key));
  if (bound !== undefined) {
    throw new RaisedError(bound);
  }
  return doneOf(frame.input);
}
