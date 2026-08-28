import { describe, expect, it } from "vitest";
import { apiOrigin, serverAssetUrl, webAssetUrl } from "./client";

describe("Headless Web cache URL mapping", () => {
  it("maps cache protocol URLs to the current Web origin", () => {
    expect(webAssetUrl("cache://covers/example.jpg")).toBe(`${apiOrigin}/cache/covers/example.jpg`);
  });

  it("repairs localhost cache URLs persisted by an older Web client", () => {
    expect(webAssetUrl("http://127.0.0.1:14558/cache/covers/example.jpg")).toBe(
      `${apiOrigin}/cache/covers/example.jpg`,
    );
  });

  it("canonicalizes Headless cache URLs before they enter main state", () => {
    expect(serverAssetUrl("http://127.0.0.1:14558/cache/covers/example.jpg")).toBe(
      "cache://covers/example.jpg",
    );
  });

  it("leaves unrelated remote artwork untouched", () => {
    const remote = "https://cdn.example.com/cache/covers/example.jpg";
    expect(webAssetUrl(remote)).toBe(remote);
    expect(serverAssetUrl(remote)).toBe(remote);
  });
});
