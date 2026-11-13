export type ReadonlyDeep<T> = { readonly [K in keyof T]: ReadonlyDeep<T[K]> };
