import type { MaybeRefOrGetter } from "vue";
import { useLibraryStore } from "@/stores/library";

export const useLibraryTracks = (enabled: MaybeRefOrGetter<boolean> = true): void => {
  const library = useLibraryStore();
  const active = ref(false);
  const visibility = useDocumentVisibility();
  watch(
    () => active.value && toValue(enabled) && visibility.value === "visible",
    (visible, _previous, onCleanup) => {
      if (visible) onCleanup(library.watchTracks());
    },
    { flush: "sync" },
  );
  onMounted(() => {
    active.value = true;
  });
  onActivated(() => {
    active.value = true;
  });
  onDeactivated(() => {
    active.value = false;
  });
};
