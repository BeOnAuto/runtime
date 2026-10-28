import {
  elementTypes,
  externalTensor,
  model,
  sequenceInfo,
  tensor,
  valueInfo,
  type Bytes,
  type Dimension,
  type Node,
} from './onnx-writer.ts';

const { float, int64 } = elementTypes;

interface Spread {
  readonly steps: number;
  readonly low: number;
  readonly high: number;
}

function shaped(name: string, steps: number): readonly Bytes[] {
  return [tensor(`${name}_cube`, int64, [3], [1, 1, 1]), tensor(`${name}_steps`, int64, [3], [1, steps, 1])];
}

function spreadNodes(level: string): readonly Node[] {
  return [
    { op: 'Reshape', inputs: [level, 'level_cube'], outputs: ['level_point'] },
    { op: 'Expand', inputs: ['level_point', 'level_steps'], outputs: ['mid'] },
    { op: 'Sub', inputs: ['mid', 'below'], outputs: ['low'] },
    { op: 'Add', inputs: ['mid', 'above'], outputs: ['high'] },
    { op: 'Concat', inputs: ['low', 'mid', 'high'], outputs: ['q'], attributes: [{ name: 'axis', int: 2 }] },
  ];
}

function spreadInitializers({ steps, low, high }: Spread): readonly Bytes[] {
  return [...shaped('level', steps), tensor('below', float, [], [low]), tensor('above', float, [], [high])];
}

const lastValue: Node = {
  op: 'Gather',
  inputs: ['y', 'last'],
  outputs: ['level'],
  attributes: [{ name: 'axis', int: 1 }],
};

const lastIndex = tensor('last', int64, [], [-1]);

export interface Inputs {
  readonly features?: number;
  readonly given?: number;
  readonly length?: Dimension;
}

function inputsOf({ features = 0, given = 0, length = 'L' }: Inputs, steps: Dimension): readonly Bytes[] {
  return [
    valueInfo('y', float, [1, length]),
    ...(features === 0 ? [] : [valueInfo('x', float, [1, length, features])]),
    ...(given === 0 ? [] : [valueInfo('given', float, [1, steps, given])]),
  ];
}

export function lastValueModel(spread: Spread, inputs: Inputs = {}, opset = 13): Bytes {
  return model({
    name: 'last_value',
    nodes: [lastValue, ...spreadNodes('level')],
    initializers: [lastIndex, ...spreadInitializers(spread)],
    inputs: inputsOf(inputs, spread.steps),
    outputs: [valueInfo('q', float, [1, spread.steps, 3])],
    opset,
  });
}

export function meanModel(spread: Spread, inputs: Inputs = {}): Bytes {
  return model({
    name: 'mean_value',
    nodes: [
      {
        op: 'ReduceMean',
        inputs: ['y'],
        outputs: ['level'],
        attributes: [
          { name: 'axes', ints: [1] },
          { name: 'keepdims', int: 0 },
        ],
      },
      ...spreadNodes('level'),
    ],
    initializers: spreadInitializers(spread),
    inputs: inputsOf(inputs, spread.steps),
    outputs: [valueInfo('q', float, [1, spread.steps, 3])],
  });
}

export function extraInputModel(spread: Spread): Bytes {
  return model({
    name: 'extra_input',
    nodes: [lastValue, ...spreadNodes('level')],
    initializers: [lastIndex, ...spreadInitializers(spread)],
    inputs: [...inputsOf({}, spread.steps), valueInfo('extra', float, [1, 1])],
    outputs: [valueInfo('q', float, [1, spread.steps, 3])],
  });
}

export function wholeNumbersModel(steps: number): Bytes {
  return model({
    name: 'whole_numbers',
    nodes: [
      { op: 'Shape', inputs: ['y'], outputs: ['unused'] },
      { op: 'Expand', inputs: ['one', 'answer_shape'], outputs: ['q'] },
    ],
    initializers: [tensor('one', int64, [], [1]), tensor('answer_shape', int64, [3], [1, steps, 3])],
    inputs: inputsOf({}, steps),
    outputs: [valueInfo('q', int64, [1, steps, 3])],
  });
}

export function allocatingModel(steps: number): Bytes {
  return model({
    name: 'allocating',
    nodes: [
      lastValue,
      { op: 'Reshape', inputs: ['level', 'level_cube'], outputs: ['level_point'] },
      { op: 'Expand', inputs: ['level_point', 'huge'], outputs: ['everything'] },
      { op: 'ReduceMean', inputs: ['everything'], outputs: ['mean'], attributes: [{ name: 'keepdims', int: 1 }] },
      { op: 'Expand', inputs: ['mean', 'level_steps'], outputs: ['mid'] },
      { op: 'Concat', inputs: ['mid', 'mid', 'mid'], outputs: ['q'], attributes: [{ name: 'axis', int: 2 }] },
    ],
    initializers: [lastIndex, ...shaped('level', steps), tensor('huge', int64, [3], [1, 65_536, 65_536])],
    inputs: inputsOf({}, steps),
    outputs: [valueInfo('q', float, [1, steps, 3])],
  });
}

export function hostileModel(steps: number, location: string): Bytes {
  return model({
    name: 'hostile',
    nodes: [
      lastValue,
      { op: 'Add', inputs: ['level', 'outside'], outputs: ['moved'] },
      { op: 'Reshape', inputs: ['moved', 'level_cube'], outputs: ['level_point'] },
      { op: 'Expand', inputs: ['level_point', 'answer_shape'], outputs: ['q'] },
    ],
    initializers: [
      lastIndex,
      tensor('level_cube', int64, [3], [1, 1, 1]),
      tensor('answer_shape', int64, [3], [1, steps, 3]),
      externalTensor('outside', [1], location),
    ],
    inputs: inputsOf({}, steps),
    outputs: [valueInfo('q', float, [1, steps, 3])],
  });
}

export function runRateModel(): Bytes {
  return model({
    name: 'run_rate',
    nodes: [
      { op: 'Slice', inputs: ['y', 'week_start', 'week_end', 'week_axis'], outputs: ['week'] },
      {
        op: 'ReduceMean',
        inputs: ['week'],
        outputs: ['rate'],
        attributes: [
          { name: 'axes', ints: [1] },
          { name: 'keepdims', int: 0 },
        ],
      },
      { op: 'Cast', inputs: ['h'], outputs: ['days'], attributes: [{ name: 'to', int: float }] },
      { op: 'Mul', inputs: ['rate', 'days'], outputs: ['total'] },
      { op: 'Reshape', inputs: ['total', 'total_cube'], outputs: ['mid'] },
      { op: 'Mul', inputs: ['mid', 'below'], outputs: ['low'] },
      { op: 'Mul', inputs: ['mid', 'above'], outputs: ['high'] },
      { op: 'Concat', inputs: ['low', 'mid', 'high'], outputs: ['q'], attributes: [{ name: 'axis', int: 2 }] },
    ],
    initializers: [
      tensor('week_start', int64, [1], [-7]),
      tensor('week_end', int64, [1], [1_000_000]),
      tensor('week_axis', int64, [1], [1]),
      tensor('total_cube', int64, [3], [1, 1, 1]),
      tensor('below', float, [], [0.8]),
      tensor('above', float, [], [1.2]),
    ],
    inputs: [valueInfo('y', float, [1, 'L']), valueInfo('h', int64, [1])],
    outputs: [valueInfo('q', float, [1, 1, 3])],
  });
}

export function sequenceModel(steps: number): Bytes {
  return model({
    name: 'sequence',
    nodes: [
      { op: 'Shape', inputs: ['y'], outputs: ['unused'] },
      { op: 'SequenceConstruct', inputs: ['answer'], outputs: ['q'] },
    ],
    initializers: [
      tensor(
        'answer',
        float,
        [1, steps, 3],
        Array.from({ length: steps * 3 }, () => 1),
      ),
    ],
    inputs: inputsOf({}, steps),
    outputs: [sequenceInfo('q', float, [1, steps, 3])],
  });
}
