export interface RuntimeSecretCodec {
  protectedAtRest: boolean;
  encode(plain: string): string;
  decode(stored: string): string;
}

const fileCodec: RuntimeSecretCodec = {
  protectedAtRest: false,
  encode: (plain) => `plain:${Buffer.from(plain, "utf8").toString("base64")}`,
  decode: (stored) => {
    if (!stored.startsWith("plain:")) return "";
    return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
  },
};

let codec = fileCodec;

/** Desktop entry 注入 safeStorage；Node Core 使用 0600 credential file 或部署环境变量。 */
export const configureRuntimeSecretCodec = (nextCodec: RuntimeSecretCodec): void => {
  codec = nextCodec;
};

export const runtimeSecretCodec: RuntimeSecretCodec = {
  get protectedAtRest() {
    return codec.protectedAtRest;
  },
  encode: (plain) => codec.encode(plain),
  decode: (stored) => codec.decode(stored),
};
