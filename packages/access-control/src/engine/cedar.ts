import * as cedarWeb from '@cedar-policy/cedar-wasm/web';

export type Cedar = Pick<
  typeof cedarWeb,
  | 'getCedarVersion'
  | 'policySetTextToParts'
  | 'policyToJson'
  | 'preparsePolicySet'
  | 'preparseSchema'
  | 'statefulIsAuthorized'
  | 'validate'
>;

export type CedarModuleSource = () => Promise<WebAssembly.Module>;

export function cedarOf(module: WebAssembly.Module): Cedar {
  cedarWeb.initSync({ module });
  return cedarWeb;
}
