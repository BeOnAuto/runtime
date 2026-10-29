import { describe, expect, it } from 'vitest';

import { windowOf } from './fed-windows.ts';
import { linearForecast, type LinearModel } from './linear-forecasts.ts';

const lastValue: LinearModel = { lags: [1, 2, 3], marks: 'none', level: 3, weights: [0, 1, 0, 0] };

const saturday = 20_750;

describe('the forecast of a regularised linear model over lags and calendar marks', () => {
  it('weighs the lags as ratios to the level of the last periods, feeds each step its own forecast, and sets the conformal bounds in that level', () => {
    expect(
      linearForecast(lastValue, {
        window: windowOf(Float64Array.of(3, 3, 3, 6)),
        steps: 2,
        at: 0,
        bounds: { low: [-0.1, -0.2], high: [0.1, 0.2] },
      }),
    ).toEqual([
      { value: 6, low: 5.6, high: 6.4 },
      { value: 6, low: 5.2, high: 6.8 },
    ]);
  });

  it('weighs the mark of the period each step lands on, a Sunday after a Saturday and then a Monday', () => {
    const sundays: LinearModel = {
      lags: [1, 2, 3],
      marks: 'day-of-week',
      level: 3,
      weights: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
    };

    expect(
      linearForecast(sundays, { window: windowOf(Float64Array.of(2, 2, 2)), steps: 2, at: saturday, bounds: null }),
    ).toEqual([
      { value: 3, low: 3, high: 3 },
      { value: 2, low: 2, high: 2 },
    ]);
  });

  it('is persistence where the last periods have no level to weigh by, or its weights overflow', () => {
    const overflowing: LinearModel = { ...lastValue, weights: [1e308, 1e308, 1e308, 1e308] };

    expect([
      linearForecast(lastValue, { window: windowOf(Float64Array.of(0, 0, 0)), steps: 1, at: 0, bounds: null }),
      linearForecast(overflowing, { window: windowOf(Float64Array.of(1, 1, 1)), steps: 1, at: 0, bounds: null }),
    ]).toEqual([[{ value: 0, low: 0, high: 0 }], [{ value: 1, low: 1, high: 1 }]]);
  });
});
