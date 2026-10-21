import { Option, Schema } from 'effect';

export type FakeParameterOperation = 'PutParameter' | 'GetParameter' | 'DeleteParameter';

export type FakeParameterState = 'answering' | 'denied' | 'stalling' | 'faulting';

export type FakeParameterTier = 'Standard' | 'Advanced';

export interface FakeParameterCall {
  readonly operation: FakeParameterOperation;
  readonly name: string;
  readonly tier?: string | undefined;
  readonly version?: number | undefined;
  readonly answer: string;
  readonly retryMode?: string | undefined;
}

export interface FakeParameter {
  readonly tier: FakeParameterTier;
  readonly versions: readonly string[];
}

interface Answer {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

type Answering = Answer | 'stalled';

interface Heard {
  readonly asked?: Omit<FakeParameterCall, 'answer'>;
  readonly answer: Answering;
}

interface Selected {
  readonly name: string;
  readonly version: number | undefined;
}

const PutSchema = Schema.Struct({
  Name: Schema.String,
  Value: Schema.String,
  Type: Schema.Literal('SecureString'),
  Overwrite: Schema.optional(Schema.Boolean),
  Tier: Schema.optional(Schema.Literals(['Standard', 'Advanced'])),
});

type Put = typeof PutSchema.Type;

const decodePut = Schema.decodeUnknownOption(Schema.fromJsonString(PutSchema));

const decodeGet = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ Name: Schema.String, WithDecryption: Schema.optional(Schema.Boolean) })),
);

const decodeDelete = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ Name: Schema.String })));

const mostStandardBytes = 4096;

const mostAdvancedBytes = 8192;

function refusal(type: string, message: string): Answer {
  return { status: 400, body: { __type: type, message } };
}

const unread: Heard = {
  answer: refusal('SerializationException', 'The request is not one the fake Parameter Store reads'),
};

export interface Kept {
  readonly region: string;
  readonly account: string;
  readonly parameters: ReadonlyMap<string, FakeParameter>;
  readonly states: ReadonlyMap<FakeParameterOperation, FakeParameterState>;
  readonly put: (name: string, parameter: FakeParameter) => void;
  readonly drop: (name: string) => boolean;
  readonly failedNow: () => string | undefined;
  readonly isFull: () => boolean;
}

function arnOf({ region, account }: Kept, name: string): string {
  return `arn:aws:ssm:${region}:${account}:parameter${name}`;
}

function stateAnswer(kept: Kept, operation: FakeParameterOperation, name: string): Answering | undefined {
  const answers: Readonly<Record<FakeParameterState, Answering | undefined>> = {
    answering: undefined,
    stalling: 'stalled',
    faulting: { status: 500, body: { __type: 'InternalServerError', message: 'An error occurred on the server side' } },
    denied: refusal(
      'AccessDeniedException',
      `User: arn:aws:iam::${kept.account}:user/runtime is not authorized to perform: ssm:${operation} on resource: ${arnOf(kept, name)} because no identity-based policy allows the ssm:${operation} action`,
    ),
  };
  return answers[kept.states.get(operation) ?? 'answering'];
}

function tierRefusal(bytes: number, tier: FakeParameterTier): Answer | undefined {
  if (bytes > mostAdvancedBytes) {
    return refusal('ValidationException', `A parameter value holds at most ${mostAdvancedBytes} bytes in any tier`);
  }
  return tier === 'Standard' && bytes > mostStandardBytes
    ? refusal(
        'ValidationException',
        `A parameter value in the standard tier holds at most ${mostStandardBytes} bytes; write a larger one in the advanced tier`,
      )
    : undefined;
}

function tierWritten(
  asked: FakeParameterTier | undefined,
  before: FakeParameter | undefined,
): FakeParameterTier | Answer {
  return asked === 'Standard' && before?.tier === 'Advanced'
    ? refusal('ValidationException', 'An advanced parameter cannot be changed to a standard parameter')
    : (asked ?? before?.tier ?? 'Standard');
}

const anotherParameter = /\{\{[^}]*\}\}/u;

function writtenTo(kept: Kept, { Name, Value, Overwrite, Tier }: Put): Answer {
  const before = kept.parameters.get(Name);
  if (before !== undefined && Overwrite !== true) {
    return refusal('ParameterAlreadyExists', 'The parameter already exists');
  }
  if (anotherParameter.test(Value)) {
    return refusal('ValidationException', 'A parameter value may not hold a reference in double braces');
  }
  const tier = tierWritten(Tier, before);
  if (typeof tier !== 'string') {
    return tier;
  }
  const versions = [...(before?.versions ?? []), Value];
  const refused = tierRefusal(Buffer.byteLength(Value), tier);
  if (refused === undefined) {
    kept.put(Name, { tier, versions });
  }
  return refused ?? { status: 200, body: { Version: versions.length, Tier: tier } };
}

function failedAs(type: string | undefined): Answer | undefined {
  if (type === undefined) {
    return undefined;
  }
  return refusal(
    type,
    type === 'ThrottlingException' ? 'Rate exceeded' : `The fake Parameter Store is told to answer ${type}`,
  );
}

function overTheQuota(kept: Kept, name: string): Answer | undefined {
  return kept.parameters.has(name) || !kept.isFull()
    ? undefined
    : refusal('ParameterLimitExceeded', 'The fake Parameter Store keeps no more parameters');
}

function versionWritten(answer: Answering): number | undefined {
  const version = answer === 'stalled' ? undefined : answer.body['Version'];
  return typeof version === 'number' ? version : undefined;
}

function written(kept: Kept, body: string): Heard {
  return Option.match(decodePut(body), {
    onNone: () => unread,
    onSome: (put) => {
      const answer =
        stateAnswer(kept, 'PutParameter', put.Name) ??
        failedAs(kept.failedNow()) ??
        overTheQuota(kept, put.Name) ??
        writtenTo(kept, put);
      return {
        asked: { operation: 'PutParameter', name: put.Name, tier: put.Tier, version: versionWritten(answer) },
        answer,
      };
    },
  });
}

function selectedBy(selector: string): Selected {
  const separator = selector.lastIndexOf(':');
  return separator === -1
    ? { name: selector, version: undefined }
    : { name: selector.slice(0, separator), version: Number(selector.slice(separator + 1)) };
}

function readFrom(kept: Kept, { name, version }: Selected, decrypted: boolean): Answer {
  const parameter = kept.parameters.get(name);
  if (parameter === undefined) {
    return refusal('ParameterNotFound', `Parameter ${name} not found.`);
  }
  const chosen = version ?? parameter.versions.length;
  const value = parameter.versions[chosen - 1];
  if (value === undefined) {
    return refusal('ParameterVersionNotFound', `Systems Manager could not find version ${chosen} of ${name}.`);
  }
  return decrypted
    ? {
        status: 200,
        body: {
          Parameter: { Name: name, Type: 'SecureString', Value: value, Version: chosen, ARN: arnOf(kept, name) },
        },
      }
    : refusal('ValidationException', 'The fake Parameter Store answers a SecureString only with its decryption');
}

function read(kept: Kept, body: string): Heard {
  return Option.match(decodeGet(body), {
    onNone: () => unread,
    onSome: ({ Name, WithDecryption }) => {
      const selected = selectedBy(Name);
      const answer =
        stateAnswer(kept, 'GetParameter', selected.name) ?? readFrom(kept, selected, WithDecryption === true);
      return { asked: { operation: 'GetParameter', ...selected }, answer };
    },
  });
}

function deleted(kept: Kept, body: string): Heard {
  return Option.match(decodeDelete(body), {
    onNone: () => unread,
    onSome: ({ Name }) => ({
      asked: { operation: 'DeleteParameter', name: Name },
      answer:
        stateAnswer(kept, 'DeleteParameter', Name) ??
        (kept.drop(Name) ? { status: 200, body: {} } : refusal('ParameterNotFound', `Parameter ${Name} not found.`)),
    }),
  });
}

export function heardAs(operation: string, body: string, kept: Kept): Heard {
  switch (operation) {
    case 'AmazonSSM.PutParameter':
      return written(kept, body);
    case 'AmazonSSM.GetParameter':
      return read(kept, body);
    case 'AmazonSSM.DeleteParameter':
      return deleted(kept, body);
    default:
      return { answer: refusal('UnknownOperationException', `The fake Parameter Store does not answer ${operation}`) };
  }
}

export function answerNamed(answer: Answering): string {
  const type = answer === 'stalled' ? answer : answer.body['__type'];
  return typeof type === 'string' ? type : 'answered';
}
