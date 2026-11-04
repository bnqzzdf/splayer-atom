import type { Ref } from "vue";
import type { SongSortScope, SortField, SortOrder } from "@/types/list";
import { DEFAULT_SONG_SORT } from "@/types/list";
import { useSettingsStore } from "@/stores/settings";

/** 按页面类别隔离 Web 展示排序；临时列表只使用组件内状态。 */
export const useSongSortPreference = (scope: Ref<SongSortScope | undefined>) => {
  const settings = useSettingsStore();
  const localField = ref<SortField>("none");
  const localOrder = ref<SortOrder>("asc");

  const sortField = computed<SortField>({
    get: () =>
      scope.value
        ? (settings.appearance.songSortPreferences[scope.value]?.field ?? DEFAULT_SONG_SORT.field)
        : localField.value,
    set: (field) => {
      if (!scope.value) {
        localField.value = field;
        return;
      }
      const previous = settings.appearance.songSortPreferences[scope.value] ?? DEFAULT_SONG_SORT;
      settings.appearance.songSortPreferences[scope.value] = { ...previous, field };
    },
  });

  const sortOrder = computed<SortOrder>({
    get: () =>
      scope.value
        ? (settings.appearance.songSortPreferences[scope.value]?.order ?? DEFAULT_SONG_SORT.order)
        : localOrder.value,
    set: (order) => {
      if (!scope.value) {
        localOrder.value = order;
        return;
      }
      const previous = settings.appearance.songSortPreferences[scope.value] ?? DEFAULT_SONG_SORT;
      settings.appearance.songSortPreferences[scope.value] = { ...previous, order };
    },
  });

  return { sortField, sortOrder };
};
