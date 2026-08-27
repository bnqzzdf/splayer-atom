import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractQobuzAppId,
  extractQobuzBundleUrl,
  extractQobuzSecrets,
} from "./credentials";

describe("Qobuz Web Player credential discovery", () => {
  it("resolves the current bundle script without depending on a fixed version", () => {
    const html = '<html><script src="/resources/8.2.0-b034/bundle.js"></script></html>';
    assert.equal(
      extractQobuzBundleUrl(html),
      "https://play.qobuz.com/resources/8.2.0-b034/bundle.js",
    );
  });

  it("extracts the production app id and qobuz-dl-style derived secret candidates", () => {
    const derivedSecret = "0123456789abcdef0123456789abcdef";
    const encoded = Buffer.from(derivedSecret, "utf8").toString("base64");
    const combined = `${encoded}${"A".repeat(44)}`;
    const seed = combined.slice(0, 20);
    const info = combined.slice(20, 40);
    const extras = combined.slice(40);
    const literalSecret = "fedcba9876543210fedcba9876543210";
    const bundle = [
      `x.initialSeed("${seed}",window.utimezone.berlin)`,
      `name:"zone/Berlin",info:"${info}",extras:"${extras}"`,
      `production:{api:{appId:"123456789",appSecret:"${literalSecret}"}}`,
    ].join(";");

    assert.equal(extractQobuzAppId(bundle), "123456789");
    assert.deepEqual(extractQobuzSecrets(bundle), [derivedSecret, literalSecret]);
  });

  it("fails loudly instead of guessing unrelated bundle values", () => {
    assert.throws(() => extractQobuzAppId("const unrelated = 123456789"), /production appId/);
    assert.throws(() => extractQobuzSecrets("const unrelated = 'abcdef'"), /签名 secret/);
  });
});
