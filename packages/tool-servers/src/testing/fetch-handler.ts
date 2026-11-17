export type FetchHandler = (request: Readonly<Request>) => Promise<Response>;

export interface FailedRequest {
  readonly method: string;
  readonly path: string;
  readonly error: string;
}

export interface HeardRequest {
  readonly method: string;
  readonly path: string;
  readonly userAgent: string | undefined;
  readonly contentLength: string | undefined;
  readonly transferEncoding: string | undefined;
}

export interface LoopbackServer {
  readonly origin: string;
  readonly heard: () => readonly HeardRequest[];
  readonly failures: () => readonly FailedRequest[];
  readonly close: () => Promise<void>;
}
