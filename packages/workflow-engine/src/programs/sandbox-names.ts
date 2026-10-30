interface DateConstructing {
  readonly called: boolean;
  readonly mostArguments: number;
}

export interface SandboxRemovals {
  readonly globals: readonly string[];
  readonly dateConstructor: DateConstructing;
  readonly mathMembers: readonly string[];
  readonly dateMethods: readonly string[];
  readonly dateTextMethods: readonly string[];
}

export const sandboxRemovals: SandboxRemovals = {
  globals: ['eval', 'Function', 'WeakRef', 'FinalizationRegistry', 'Promise'],
  dateConstructor: { called: false, mostArguments: 1 },
  mathMembers: ['random'],
  dateMethods: [
    'getDate',
    'getDay',
    'getFullYear',
    'getHours',
    'getMilliseconds',
    'getMinutes',
    'getMonth',
    'getSeconds',
    'getTimezoneOffset',
    'getYear',
    'setDate',
    'setFullYear',
    'setHours',
    'setMilliseconds',
    'setMinutes',
    'setMonth',
    'setSeconds',
    'setYear',
    'toDateString',
    'toLocaleDateString',
    'toLocaleTimeString',
    'toTimeString',
  ],
  dateTextMethods: ['toString', 'toLocaleString'],
};
