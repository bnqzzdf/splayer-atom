export interface RuntimeSecretCodec {
  protectedAtRest: boolean;
  encode(plain: string): string;
  decode(stored: string): string;
}

/** Core credential 文件以 0600 权限持久化；这里仅负责稳定文本编码。 */
export const runtimeSecretCodec: RuntimeSecretCodec = {
  protectedAtRest: false,
  encode: (plain) => `plain:${Buffer.from(plain, "utf8").toString("base64")}`,
  decode: (stored) => {
    if (!stored.startsWith("plain:")) return "";
    return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
  },
};
