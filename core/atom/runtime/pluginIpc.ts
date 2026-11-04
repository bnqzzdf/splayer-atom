const BYTE_TAG = "__atomIpcBytes";
const ARRAY_BUFFER_TAG = "__atomIpcArrayBuffer";

export const encodePluginIpc = (value: unknown): unknown => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { [BYTE_TAG]: Buffer.from(value).toString("base64") };
  }
  if (value instanceof ArrayBuffer) {
    return { [ARRAY_BUFFER_TAG]: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encodePluginIpc);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodePluginIpc(item)]),
    );
  }
  return value;
};

export const decodePluginIpc = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodePluginIpc);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === BYTE_TAG && typeof entries[0][1] === "string") {
      return new Uint8Array(Buffer.from(entries[0][1], "base64"));
    }
    if (
      entries.length === 1 &&
      entries[0][0] === ARRAY_BUFFER_TAG &&
      typeof entries[0][1] === "string"
    ) {
      return Uint8Array.from(Buffer.from(entries[0][1], "base64")).buffer;
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, decodePluginIpc(item)]));
  }
  return value;
};
