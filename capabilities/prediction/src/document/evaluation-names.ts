import { Schema } from 'effect';

export const BaselineSchema = Schema.Literals(['persistence', 'seasonal-naive']);

export const MetricSchema = Schema.Literals(['mase', 'winkler', 'quantile']);
