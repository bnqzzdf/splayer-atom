import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import { afterEach, expect, it, vi } from "vitest";
import { useStatusStore } from "./status";

afterEach(() => vi.unstubAllGlobals());

it("drops unscoped legacy song sorting from persisted status", () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  localStorage.setItem(
    "status",
    JSON.stringify({ sortField: "title", sortOrder: "desc", settingsCategory: "appearance" }),
  );
  const pinia = createPinia();
  pinia.use(piniaPersistedstate);
  createApp(() => null).use(pinia);
  setActivePinia(pinia);
  useStatusStore();

  expect(JSON.parse(localStorage.getItem("status") ?? "{}")).not.toHaveProperty("sortField");
  expect(JSON.parse(localStorage.getItem("status") ?? "{}")).not.toHaveProperty("sortOrder");
});
