import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import { afterEach, expect, it } from "vitest";
import { useStatusStore } from "./status";

afterEach(() => localStorage.removeItem("status"));

it("drops unscoped legacy song sorting from persisted status", () => {
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
