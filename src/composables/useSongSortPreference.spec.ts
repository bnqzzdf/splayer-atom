import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { useSongSortPreference } from "./useSongSortPreference";
import { useSettingsStore } from "@/stores/settings";
import type { SongSortScope } from "@/types/list";
import { normalizeSongSortPreferences } from "@/types/list";

describe("song list page-scoped sorting", () => {
  it("does not leak a changed sort into albums, liked music or history", () => {
    setActivePinia(createPinia());
    const scope = ref<SongSortScope | undefined>("songs");
    const { sortField, sortOrder } = useSongSortPreference(scope);
    sortField.value = "title";
    sortOrder.value = "desc";

    scope.value = "album";
    expect([sortField.value, sortOrder.value]).toEqual(["none", "asc"]);
    sortField.value = "track";
    scope.value = "liked";
    expect([sortField.value, sortOrder.value]).toEqual(["none", "asc"]);
    scope.value = "history";
    expect([sortField.value, sortOrder.value]).toEqual(["none", "asc"]);
    scope.value = "songs";
    expect([sortField.value, sortOrder.value]).toEqual(["title", "desc"]);
    expect(useSettingsStore().appearance.songSortPreferences.album).toEqual({
      field: "track",
      order: "asc",
    });
  });

  it("keeps an unscoped temporary list out of persisted category preferences", () => {
    setActivePinia(createPinia());
    const scope = ref<SongSortScope | undefined>(undefined);
    const { sortField, sortOrder } = useSongSortPreference(scope);
    sortField.value = "duration";
    sortOrder.value = "desc";
    expect([sortField.value, sortOrder.value]).toEqual(["duration", "desc"]);
    expect(useSettingsStore().appearance.songSortPreferences).toEqual({});
  });

  it("discards invalid or entity-specific stored keys and restores category values", () => {
    expect(
      normalizeSongSortPreferences({
        album: { field: "track", order: "asc" },
        playlist: { field: "title", order: "desc" },
        "playlist:123": { field: "artist", order: "asc" },
        history: { field: "missing", order: "asc" },
      }),
    ).toEqual({
      album: { field: "track", order: "asc" },
      playlist: { field: "title", order: "desc" },
    });
  });
});
