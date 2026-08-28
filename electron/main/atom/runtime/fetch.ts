export type RuntimeFetch = typeof globalThis.fetch;

let fetchImpl: RuntimeFetch = globalThis.fetch.bind(globalThis);

/** Desktop entry 可注入 Electron net.fetch；Node Core 默认使用 Node fetch。 */
export const configureRuntimeFetch = (nextFetch: RuntimeFetch): void => {
  fetchImpl = nextFetch;
};

export const runtimeFetch: RuntimeFetch = (input, init) => fetchImpl(input, init);
