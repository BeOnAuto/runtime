import { Function, Tracer } from 'effect';

/** The tracer given, which also says when each span it began has ended, so a test can wait for a span to end. */
export function endingsToldOf(tracer: Tracer.Tracer, ended: () => void): Tracer.Tracer {
  const toldWhenEnded = <Span extends Tracer.Span>(span: Span): Span => {
    span.end = Function.flow(span.end.bind(span), ended);
    return span;
  };
  return Tracer.make({ span: Function.flow(tracer.span.bind(tracer), toldWhenEnded) });
}
