const leastPivot = 1e-12;

export interface NormalEquations {
  readonly add: (features: readonly number[], target: number) => void;
  readonly samples: () => number;
  readonly solved: (penalty: number) => readonly number[] | undefined;
}

function solvedSystem(gram: Readonly<Float64Array>, moments: Readonly<Float64Array>): readonly number[] | undefined {
  const width = moments.length;
  const stride = width + 1;
  const rows = new Float64Array(width * stride);
  const at = (row: number, column: number): number => Number(rows[row * stride + column]);
  for (let row = 0; row < width; row += 1) {
    rows.set(gram.subarray(row * width, row * width + width), row * stride);
    rows[row * stride + width] = Number(moments[row]);
  }
  const pivotOf = (column: number): number => {
    let best = column;
    for (let row = column + 1; row < width; row += 1) {
      best = Math.abs(at(row, column)) > Math.abs(at(best, column)) ? row : best;
    }
    return best;
  };
  const swapped = (one: number, other: number): void => {
    const held = rows.slice(one * stride, one * stride + stride);
    rows.copyWithin(one * stride, other * stride, other * stride + stride);
    rows.set(held, other * stride);
  };
  const eliminated = (column: number): void => {
    for (let row = column + 1; row < width; row += 1) {
      const factor = at(row, column) / at(column, column);
      for (let place = column; place < stride; place += 1) {
        rows[row * stride + place] = at(row, place) - factor * at(column, place);
      }
    }
  };
  for (let column = 0; column < width; column += 1) {
    swapped(column, pivotOf(column));
    if (Math.abs(at(column, column)) < leastPivot) {
      return undefined;
    }
    eliminated(column);
  }
  const solution = new Float64Array(width);
  for (let row = width - 1; row >= 0; row -= 1) {
    let rest = at(row, width);
    for (let column = row + 1; column < width; column += 1) {
      rest -= at(row, column) * Number(solution[column]);
    }
    solution[row] = rest / at(row, row);
  }
  return [...solution];
}

export function normalEquations(width: number): NormalEquations {
  const gram = new Float64Array(width * width);
  const moments = new Float64Array(width);
  const added = { samples: 0 };
  return {
    samples: () => added.samples,
    add: (features, target) => {
      added.samples += 1;
      for (let row = 0; row < width; row += 1) {
        const feature = Number(features[row]);
        moments[row] = Number(moments[row]) + feature * target;
        for (let column = 0; column < width; column += 1) {
          gram[row * width + column] = Number(gram[row * width + column]) + feature * Number(features[column]);
        }
      }
    },
    solved: (penalty) => {
      const penalised = Float64Array.from(gram);
      for (let row = 1; row < width; row += 1) {
        penalised[row * width + row] = Number(penalised[row * width + row]) + penalty;
      }
      return solvedSystem(penalised, moments);
    },
  };
}
