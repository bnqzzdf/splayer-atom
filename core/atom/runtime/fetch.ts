export type RuntimeFetch = typeof globalThis.fetch;

/** Core 统一使用 Node 原生 fetch。 */
export const runtimeFetch: RuntimeFetch = globalThis.fetch.bind(globalThis);
