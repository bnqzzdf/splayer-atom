import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePlayerLayout } from "./settings";

test("legacy full-screen cover is preserved during player layout migration", () => {
  assert.equal(resolvePlayerLayout(undefined, "fullscreen"), "fullCover");
  assert.equal(resolvePlayerLayout(undefined, "default"), "classic");
  assert.equal(resolvePlayerLayout(undefined, undefined), "classic");
});

test("valid new player layout takes precedence over legacy cover preference", () => {
  for (const layout of ["classic", "fullCover", "apple"] as const) {
    assert.equal(resolvePlayerLayout(layout, "fullscreen"), layout);
  }
  assert.equal(resolvePlayerLayout("unknown", "fullscreen"), "fullCover");
  assert.equal(resolvePlayerLayout("unknown", "default"), "classic");
});
