import { meanModel } from '../candidates/candidate-graphs.ts';
import { elementTypes, model, tensor, valueInfo, type Bytes } from '../candidates/onnx-writer.ts';

const { float, int64 } = elementTypes;

export const largeModelFloats = 16_777_216;

export function largeModel(floats: number): Uint8Array {
  return Uint8Array.from(
    model({
      name: 'large_mean',
      nodes: [
        { op: 'ReduceSum', inputs: ['weights'], outputs: ['weighed'], attributes: [{ name: 'keepdims', int: 0 }] },
        { op: 'Mul', inputs: ['weighed', 'nothing'], outputs: ['zero'] },
        {
          op: 'ReduceMean',
          inputs: ['y'],
          outputs: ['mean'],
          attributes: [
            { name: 'axes', ints: [1] },
            { name: 'keepdims', int: 0 },
          ],
        },
        { op: 'Add', inputs: ['mean', 'zero'], outputs: ['level'] },
        { op: 'Reshape', inputs: ['level', 'level_cube'], outputs: ['level_point'] },
        { op: 'Expand', inputs: ['level_point', 'level_steps'], outputs: ['mid'] },
        { op: 'Sub', inputs: ['mid', 'below'], outputs: ['low'] },
        { op: 'Add', inputs: ['mid', 'above'], outputs: ['high'] },
        { op: 'Concat', inputs: ['low', 'mid', 'high'], outputs: ['q'], attributes: [{ name: 'axis', int: 2 }] },
      ],
      initializers: [
        tensor(
          'weights',
          float,
          [floats],
          Array.from({ length: floats }, () => 1),
        ),
        tensor('nothing', float, [], [0]),
        tensor('level_cube', int64, [3], [1, 1, 1]),
        tensor('level_steps', int64, [3], [1, 2, 1]),
        tensor('below', float, [], [2]),
        tensor('above', float, [], [2]),
      ],
      inputs: [valueInfo('y', float, [1, 'L'])],
      outputs: [valueInfo('q', float, [1, 2, 3])],
    }),
  );
}

export function meanModelOfTheMeasures(): Bytes {
  return meanModel({ steps: 2, low: 2, high: 2 });
}
