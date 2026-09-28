<script setup lang="ts">
defineOptions({ name: "Folders" });

import type {
  FolderBatchTarget,
  FolderBrowseEntry,
  FolderBrowseOrder,
  FolderBrowsePage,
  FolderBrowseSort,
  FolderContainerResult,
  FolderDirectoryEntry,
  FolderMaterialEntry,
  FolderPinEntry,
  FolderRootEntry,
  FolderSearchResult,
} from "@shared/types/folderBrowser";
import type { ScanProgress } from "@shared/types/library";
import type { Track } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { folderBrowserClient } from "@/core/folderBrowserClient";
import { subscribeCoreControlEvent } from "@/core/controlEventClient";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { usePlaylistStore } from "@/stores/playlist";
import { useSettingsStore } from "@/stores/settings";
import type { FolderViewMode } from "@/types/settings";
import { toast } from "@/composables/useToast";
import { formatFileSize } from "@/utils/format";
import { appendFolderPath, folderPathWithinRoot } from "@/utils/folderPath";
import * as player from "@/core/player";
import IconFolder from "~icons/lucide/folder";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconMusic from "~icons/lucide/music";
import IconFileAudio from "~icons/lucide/file-audio";
import IconDisc3 from "~icons/lucide/disc-3";
import IconFileText from "~icons/lucide/file-text";
import IconImage from "~icons/lucide/image";
import IconFile from "~icons/lucide/file";
import IconPlay from "~icons/lucide/play";
import IconEllipsis from "~icons/lucide/ellipsis";
import IconSearch from "~icons/lucide/search";
import IconPin from "~icons/lucide/pin";
import IconPinOff from "~icons/lucide/pin-off";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconListEnd from "~icons/lucide/list-end";
import IconListMusic from "~icons/lucide/list-music";
import IconListPlus from "~icons/lucide/list-plus";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconSettings2 from "~icons/lucide/settings-2";
import IconZoomIn from "~icons/lucide/zoom-in";
import IconZoomOut from "~icons/lucide/zoom-out";
import IconShuffle from "~icons/lucide/shuffle";
import IconList from "~icons/lucide/list";
import IconLayoutGrid from "~icons/lucide/layout-grid";
import IconListChecks from "~icons/lucide/list-checks";
import IconArrowLeftRight from "~icons/lucide/arrow-left-right";
import IconArrowUp from "~icons/lucide/arrow-up";
import IconArrowDown from "~icons/lucide/arrow-down";
import IconArrowUpDown from "~icons/lucide/arrow-up-down";
import IconX from "~icons/lucide/x";

type ViewRow =
  | { kind: "section"; key: string; label: string; count: number }
  | { kind: "directory-grid"; key: string; entries: FolderDirectoryEntry[] }
  | { kind: "entry"; key: string; entry: FolderBrowseEntry }
  | { kind: "container-track"; key: string; track: Track; containerPath: string };

type FolderScrollState = {
  top: number;
  anchorPath?: string;
  anchorOffset: number;
};

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const settingsDialog = useSettingsDialog();
const playlistStore = usePlaylistStore();
const settings = useSettingsStore();

const routeText = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";

const parseFolderSort = (value: unknown): FolderBrowseSort | null => {
  const text = routeText(value);
  return text === "name" || text === "mtime" || text === "track" ? text : null;
};
const parseFolderOrder = (value: unknown): FolderBrowseOrder | null => {
  const text = routeText(value);
  return text === "asc" || text === "desc" ? text : null;
};
const defaultFolderOrder = (sort: FolderBrowseSort): FolderBrowseOrder =>
  sort === "mtime" ? "desc" : "asc";

const currentPath = computed(() => routeText(route.query.path));
const requestedContainerPath = computed(() => routeText(route.query.container));
const requestedFocusId = computed(() => routeText(route.query.focus));
const requestedFocusPath = computed(() => routeText(route.query.focusPath));
const routeFolderSort = computed(() => parseFolderSort(route.query.sort));
const routeFolderOrder = computed(() => parseFolderOrder(route.query.order));
const currentSort = computed<FolderBrowseSort>(
  () => routeFolderSort.value ?? settings.appearance.folderBrowseSort,
);
const currentOrder = computed<FolderBrowseOrder>(() => {
  if (routeFolderOrder.value) return routeFolderOrder.value;
  return routeFolderSort.value
    ? defaultFolderOrder(routeFolderSort.value)
    : settings.appearance.folderBrowseOrder;
});

const roots = shallowRef<FolderRootEntry[]>([]);
const pins = shallowRef<FolderPinEntry[]>([]);
const page = shallowRef<FolderBrowsePage | null>(null);
const entries = shallowRef<FolderBrowseEntry[]>([]);
const previousCursor = ref<string>();
const nextCursor = ref<string>();
const container = shallowRef<FolderContainerResult | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const listRef = shallowRef<SVirtualListExposed | null>(null);
const loadedPath = ref("");
const loadedFilter = ref("");
const loadedSort = ref<FolderBrowseSort>("name");
const loadedOrder = ref<FolderBrowseOrder>("asc");
const scrollPositions = new Map<string, FolderScrollState>();
const folderFilters = new Map<string, string>();
const highlightKey = ref("");
let highlightTimer: number | null = null;
let browseGeneration = 0;

const scanProgress = shallowRef<ScanProgress | null>(null);
const scanning = computed(() => scanProgress.value?.phase === "scanning");
const scanCoversCurrent = computed(() => {
  if (!scanning.value || !currentPath.value) return false;
  return scanProgress.value?.scopeDirs?.some((scope) =>
    folderPathWithinRoot(currentPath.value, scope),
  ) ?? false;
});

const searchQuery = ref("");
const searchLoading = ref(false);
const searchResults = shallowRef<FolderSearchResult[]>([]);
const searchCursor = ref<string>();
let searchGeneration = 0;
let searchAbortController: AbortController | null = null;

const filterQuery = ref("");
let ignoreFilterReload = false;
const folderViewMode = computed<FolderViewMode>({
  get: () => settings.appearance.folderViewMode,
  set: (value) => {
    settings.appearance.folderViewMode = value;
  },
});
const folderSortOptions = computed(() => [
  { label: t("folder.sortName"), value: "name" },
  { label: t("folder.sortMtime"), value: "mtime" },
  { label: t("folder.sortTrack"), value: "track" },
]);
const directoryThumbnailFailures = shallowRef<Set<string>>(new Set());
const batchActive = ref(false);
const batchSelectedKeys = shallowRef<Set<string>>(new Set());

const createOpen = ref(false);
const playlistPickerOpen = ref(false);
const playlistSubmitting = ref(false);
const createRecursive = ref(true);
const createTargetPath = ref("");
const createTargetTrack = shallowRef<{ containerPath: string; trackId: string; title: string } | null>(
  null,
);
const createBatchTargets = shallowRef<FolderBatchTarget[] | null>(null);

const viewerOpen = ref(false);
const viewerMaterial = shallowRef<FolderMaterialEntry | null>(null);
const viewerText = ref("");
const viewerTextTruncated = ref(false);
const viewerLoading = ref(false);
const textViewerRef = ref<HTMLElement | null>(null);
const pdfPage = ref(1);
const pdfZoom = ref(100);
const viewerStates = new Map<string, { page: number; zoom: number; textScroll: number }>();

const imageMaterials = computed(() =>
  entries.value.filter(
    (entry): entry is FolderMaterialEntry =>
      entry.kind === "material" && entry.materialType === "image",
  ),
);
const viewerImageIndex = computed(() => {
  const material = viewerMaterial.value;
  if (!material || material.materialType !== "image") return -1;
  return imageMaterials.value.findIndex((item) => item.path === material.path);
});

const currentPinned = computed(
  () => !!currentPath.value && pins.value.some((item) => item.path === currentPath.value),
);

const breadcrumb = computed(() => {
  if (!page.value) return [];
  const root = page.value.root;
  const relative = page.value.path.slice(root.length).replace(/^[/\\]+/, "");
  const segments = relative ? relative.split(/[/\\]+/).filter(Boolean) : [];
  const rows = [{ name: root.split(/[/\\]/).filter(Boolean).pop() || root, path: root }];
  let cursor = root;
  for (const segment of segments) {
    cursor = appendFolderPath(cursor, segment);
    rows.push({ name: segment, path: cursor });
  }
  return rows;
});

const viewRows = computed<ViewRow[]>(() => {
  const directories = entries.value.filter((entry) => entry.kind === "directory");
  const materials = entries.value.filter((entry) => entry.kind === "material");
  const media = entries.value.filter(
    (entry) => entry.kind !== "directory" && entry.kind !== "material",
  );
  const rows: ViewRow[] = [];
  const append = (key: string, label: string, group: FolderBrowseEntry[], count: number) => {
    if (group.length === 0) return;
    rows.push({ kind: "section", key: "section:" + key, label, count });
    for (const entry of group) {
      rows.push({ kind: "entry", key: "entry:" + entry.path, entry });
      if (
        container.value &&
        entry.path === container.value.path &&
        (entry.kind === "cue" || entry.kind === "sacd")
      ) {
        for (const track of container.value.tracks) {
          rows.push({
            kind: "container-track",
            key: "container-track:" + track.id,
            track,
            containerPath: entry.path,
          });
        }
      }
    }
  };
  if (folderViewMode.value === "list") {
    append(
      "folders",
      t("folder.subfolders"),
      directories,
      page.value?.counts.directories ?? directories.length,
    );
  } else if (directories.length > 0) {
    rows.push({
      kind: "section",
      key: "section:folders",
      label: t("folder.subfolders"),
      count: page.value?.counts.directories ?? directories.length,
    });
    for (let index = 0; index < directories.length; index += 6) {
      rows.push({
        kind: "directory-grid",
        key: `directory-grid:${index}`,
        entries: directories.slice(index, index + 6),
      });
    }
  }
  append("tracks", t("folder.tracks"), media, page.value?.counts.media ?? media.length);
  append(
    "materials",
    t("folder.materials"),
    materials,
    page.value?.counts.materials ?? materials.length,
  );
  return rows;
});

const batchTargetForRow = (
  row: ViewRow,
): { key: string; target: FolderBatchTarget } | null => {
  if (row.kind === "container-track") {
    return {
      key: row.key,
      target: {
        kind: "container-track",
        containerPath: row.containerPath,
        trackId: row.track.id,
      },
    };
  }
  if (row.kind !== "entry") return null;
  if (row.entry.kind === "directory" || row.entry.kind === "material") return null;
  return { key: row.key, target: { kind: "path", path: row.entry.path } };
};

const batchCandidates = computed(() =>
  viewRows.value
    .map(batchTargetForRow)
    .filter(
      (item): item is { key: string; target: FolderBatchTarget } => item !== null,
    ),
);
const batchSelectedTargets = computed(() =>
  batchCandidates.value
    .filter((item) => batchSelectedKeys.value.has(item.key))
    .map((item) => item.target),
);
const batchSelectedCount = computed(() => batchSelectedTargets.value.length);
const batchAllSelected = computed(
  () =>
    batchCandidates.value.length > 0 &&
    batchSelectedCount.value === batchCandidates.value.length,
);
const batchPartialSelected = computed(
  () => batchSelectedCount.value > 0 && !batchAllSelected.value,
);

const setBatchSelection = (keys: Iterable<string>): void => {
  batchSelectedKeys.value = new Set(keys);
};

const enterBatch = (): void => {
  batchActive.value = true;
  setBatchSelection([]);
};

const exitBatch = (): void => {
  batchActive.value = false;
  setBatchSelection([]);
};

const toggleBatchKey = (key: string): void => {
  const next = new Set(batchSelectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  batchSelectedKeys.value = next;
};

const toggleBatchAll = (): void => {
  if (batchAllSelected.value) setBatchSelection([]);
  else setBatchSelection(batchCandidates.value.map((item) => item.key));
};

const invertBatchSelection = (): void => {
  setBatchSelection(
    batchCandidates.value
      .filter((item) => !batchSelectedKeys.value.has(item.key))
      .map((item) => item.key),
  );
};

const pdfUrl = computed(() => {
  if (!viewerMaterial.value || viewerMaterial.value.materialType !== "pdf") return "";
  return (
    folderBrowserClient.materialUrl(viewerMaterial.value.path) +
    "#page=" +
    pdfPage.value +
    "&zoom=" +
    pdfZoom.value
  );
});

const materialHasThumbnail = (material: FolderMaterialEntry): boolean =>
  material.materialType === "image" && !material.path.toLowerCase().endsWith(".gif");

const rowAnchorPath = (row: ViewRow | undefined): string | undefined => {
  if (!row || row.kind === "section") return undefined;
  if (row.kind === "entry") return row.entry.path;
  if (row.kind === "container-track") return row.containerPath;
  return row.entries[0]?.path;
};

const rowContainsPath = (row: ViewRow, path: string): boolean => {
  if (row.kind === "entry") return row.entry.path === path;
  if (row.kind === "container-track") return row.containerPath === path;
  if (row.kind === "directory-grid") return row.entries.some((entry) => entry.path === path);
  return false;
};

const folderScrollStateKey = (
  path: string,
  filter: string,
  sort: FolderBrowseSort,
  order: FolderBrowseOrder,
): string => [path, filter.trim(), sort, order].join("\u0000");

const saveCurrentScroll = (): void => {
  if (!loadedPath.value || !listRef.value) return;
  const top = listRef.value.getScrollTop();
  let anchorIndex = Math.max(0, listRef.value.actualStartIndex);
  while (anchorIndex < viewRows.value.length && viewRows.value[anchorIndex]?.kind === "section") {
    anchorIndex++;
  }
  const anchorPath = rowAnchorPath(viewRows.value[anchorIndex]);
  const anchorOffset =
    anchorPath && anchorIndex < viewRows.value.length
      ? top - listRef.value.getItemTop(anchorIndex)
      : 0;
  scrollPositions.set(
    folderScrollStateKey(
      loadedPath.value,
      loadedFilter.value,
      loadedSort.value,
      loadedOrder.value,
    ),
    { top, anchorPath, anchorOffset },
  );
};

const restoreScroll = async (
  path: string,
  filter: string,
  sort: FolderBrowseSort,
  order: FolderBrowseOrder,
): Promise<void> => {
  const state = scrollPositions.get(folderScrollStateKey(path, filter, sort, order));
  if (!state || state.top <= 0) return;
  await nextTick();
  const list = listRef.value;
  if (!list) return;
  if (state.anchorPath) {
    const anchorIndex = viewRows.value.findIndex((row) => rowContainsPath(row, state.anchorPath!));
    if (anchorIndex >= 0) {
      list.scrollTo(list.getItemTop(anchorIndex) + state.anchorOffset);
      return;
    }
  }
  list.scrollTo(state.top);
};

const loadRoots = async (): Promise<void> => {
  const data = await folderBrowserClient.getRoots();
  roots.value = data.roots;
  pins.value = data.pins;
};

const focusRequestedEntry = async (): Promise<void> => {
  const id = requestedFocusId.value;
  const focusPath = requestedFocusPath.value;
  if (!id && !focusPath) return;
  await nextTick();
  const index = viewRows.value.findIndex((row) => {
    if (row.kind === "container-track") return !!id && row.track.id === id;
    if (row.kind !== "entry") return false;
    if (focusPath && row.entry.path === focusPath) return true;
    return row.entry.kind === "track" && !!id && row.entry.track.id === id;
  });
  if (index < 0) return;
  listRef.value?.scrollToIndex(index, "smooth");
  highlightKey.value = viewRows.value[index]?.key ?? "";
  if (highlightTimer !== null) window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    highlightKey.value = "";
    highlightTimer = null;
  }, 2500);
};

const loadContainer = async (): Promise<void> => {
  const target = requestedContainerPath.value;
  const folderPath = currentPath.value;
  if (!target || !folderPath) {
    container.value = null;
    await focusRequestedEntry();
    return;
  }
  try {
    const result = await folderBrowserClient.openContainer(target);
    if (requestedContainerPath.value !== target || currentPath.value !== folderPath) return;
    container.value = result;
    await focusRequestedEntry();
  } catch {
    if (requestedContainerPath.value !== target || currentPath.value !== folderPath) return;
    container.value = null;
    toast.error(t("folder.containerLoadFailed"));
  }
};

const loadCurrent = async (focusOverride?: string, restoreSavedPosition = true): Promise<void> => {
  saveCurrentScroll();
  const generation = ++browseGeneration;
  const target = currentPath.value;
  const activeFilter = filterQuery.value.trim();
  const activeSort = currentSort.value;
  const activeOrder = currentOrder.value;
  directoryThumbnailFailures.value = new Set();
  loadedPath.value = target;
  error.value = "";
  entries.value = [];
  previousCursor.value = undefined;
  nextCursor.value = undefined;
  page.value = null;
  container.value = null;
  loadingMore.value = false;
  if (!target) {
    loadedFilter.value = "";
    loadedSort.value = activeSort;
    loadedOrder.value = activeOrder;
    loading.value = true;
    try {
      await loadRoots();
    } catch (value) {
      if (generation === browseGeneration && !currentPath.value) {
        error.value = value instanceof Error ? value.message : String(value);
      }
    } finally {
      if (generation === browseGeneration) loading.value = false;
    }
    return;
  }
  loading.value = true;
  try {
    const scrollStateKey = folderScrollStateKey(target, activeFilter, activeSort, activeOrder);
    const savedAnchorPath = restoreSavedPosition
      ? scrollPositions.get(scrollStateKey)?.anchorPath
      : undefined;
    const explicitFocusPath = requestedContainerPath.value || requestedFocusPath.value;
    const result = await folderBrowserClient.browse({
      path: target,
      limit: 200,
      focusPath:
        focusOverride ||
        explicitFocusPath ||
        savedAnchorPath ||
        undefined,
      filter: activeFilter || undefined,
      sort: activeSort,
      order: activeOrder,
    });
    if (
      generation !== browseGeneration ||
      currentPath.value !== target ||
      filterQuery.value.trim() !== activeFilter ||
      currentSort.value !== activeSort ||
      currentOrder.value !== activeOrder
    ) {
      return;
    }
    if (
      activeFilter &&
      explicitFocusPath &&
      !result.entries.some((entry) => entry.path === explicitFocusPath)
    ) {
      ignoreFilterReload = true;
      filterQuery.value = "";
      ignoreFilterReload = false;
      folderFilters.set(target, "");
      exitBatch();
      await loadCurrent(explicitFocusPath, false);
      return;
    }
    page.value = result;
    entries.value = result.entries;
    previousCursor.value = result.previousCursor;
    nextCursor.value = result.nextCursor;
    loadedFilter.value = activeFilter;
    loadedSort.value = activeSort;
    loadedOrder.value = activeOrder;
    if (restoreSavedPosition) {
      await restoreScroll(target, activeFilter, activeSort, activeOrder);
    }
    await loadContainer();
  } catch (value) {
    if (
      generation === browseGeneration &&
      currentPath.value === target &&
      filterQuery.value.trim() === activeFilter &&
      currentSort.value === activeSort &&
      currentOrder.value === activeOrder
    ) {
      error.value = value instanceof Error ? value.message : String(value);
    }
  } finally {
    if (generation === browseGeneration) loading.value = false;
  }
};

const markDirectoryThumbnailFailed = (path: string): void => {
  if (directoryThumbnailFailures.value.has(path)) return;
  const next = new Set(directoryThumbnailFailures.value);
  next.add(path);
  directoryThumbnailFailures.value = next;
};

const refreshCurrent = async (): Promise<void> => {
  const target = currentPath.value;
  saveCurrentScroll();
  const state = scrollPositions.get(
    folderScrollStateKey(target, loadedFilter.value, loadedSort.value, loadedOrder.value),
  );
  const anchorPath = state?.anchorPath;
  await loadCurrent(anchorPath, false);
  if (currentPath.value !== target || loadedPath.value !== target) return;
  await restoreScroll(target, loadedFilter.value, loadedSort.value, loadedOrder.value);
};

const loadMore = async (): Promise<void> => {
  if (
    !currentPath.value ||
    !nextCursor.value ||
    loadingMore.value ||
    filterQuery.value.trim() !== loadedFilter.value ||
    currentSort.value !== loadedSort.value ||
    currentOrder.value !== loadedOrder.value
  )
    return;
  const generation = browseGeneration;
  const target = currentPath.value;
  const activeFilter = loadedFilter.value;
  const activeSort = loadedSort.value;
  const activeOrder = loadedOrder.value;
  const cursor = nextCursor.value;
  loadingMore.value = true;
  try {
    const result = await folderBrowserClient.browse({
      path: target,
      cursor,
      limit: 200,
      filter: activeFilter || undefined,
      sort: activeSort,
      order: activeOrder,
    });
    if (
      generation !== browseGeneration ||
      currentPath.value !== target ||
      loadedFilter.value !== activeFilter ||
      currentSort.value !== activeSort ||
      currentOrder.value !== activeOrder
    ) {
      return;
    }
    page.value = result;
    entries.value = [...entries.value, ...result.entries];
    nextCursor.value = result.nextCursor;
  } catch (value) {
    if (
      generation !== browseGeneration ||
      currentPath.value !== target ||
      loadedFilter.value !== activeFilter ||
      currentSort.value !== activeSort ||
      currentOrder.value !== activeOrder
    ) {
      return;
    }
    if (value instanceof Error && value.message === "FOLDER_CURSOR_STALE") {
      await refreshCurrent();
    } else {
      toast.error(value instanceof Error ? value.message : String(value));
    }
  } finally {
    loadingMore.value = false;
  }
};

const loadPrevious = async (): Promise<void> => {
  if (
    !currentPath.value ||
    !previousCursor.value ||
    loadingMore.value ||
    filterQuery.value.trim() !== loadedFilter.value ||
    currentSort.value !== loadedSort.value ||
    currentOrder.value !== loadedOrder.value
  )
    return;
  const generation = browseGeneration;
  const target = currentPath.value;
  const activeFilter = loadedFilter.value;
  const activeSort = loadedSort.value;
  const activeOrder = loadedOrder.value;
  const cursor = previousCursor.value;
  loadingMore.value = true;
  const rowsBefore = viewRows.value;
  const anchorIndex = Math.max(0, listRef.value?.actualStartIndex ?? 0);
  const anchorKey = rowsBefore[anchorIndex]?.key;
  const scrollTop = listRef.value?.getScrollTop() ?? 0;
  const anchorOffset =
    anchorKey && listRef.value ? scrollTop - listRef.value.getItemTop(anchorIndex) : 0;
  try {
    const result = await folderBrowserClient.browse({
      path: target,
      cursor,
      limit: 200,
      filter: activeFilter || undefined,
      sort: activeSort,
      order: activeOrder,
    });
    if (
      generation !== browseGeneration ||
      currentPath.value !== target ||
      loadedFilter.value !== activeFilter ||
      currentSort.value !== activeSort ||
      currentOrder.value !== activeOrder
    ) {
      return;
    }
    entries.value = [...result.entries, ...entries.value];
    previousCursor.value = result.previousCursor;
    await nextTick();
    if (anchorKey && listRef.value) {
      const nextIndex = viewRows.value.findIndex((row) => row.key === anchorKey);
      if (nextIndex >= 0) {
        listRef.value.scrollTo(listRef.value.getItemTop(nextIndex) + anchorOffset);
      }
    }
  } catch (value) {
    if (
      generation !== browseGeneration ||
      currentPath.value !== target ||
      loadedFilter.value !== activeFilter ||
      currentSort.value !== activeSort ||
      currentOrder.value !== activeOrder
    ) {
      return;
    }
    if (value instanceof Error && value.message === "FOLDER_CURSOR_STALE") {
      await refreshCurrent();
    } else {
      toast.error(value instanceof Error ? value.message : String(value));
    }
  } finally {
    loadingMore.value = false;
  }
};

const goFolder = async (path: string): Promise<void> => {
  await router.push({
    name: "folders",
    query: { path, sort: currentSort.value, order: currentOrder.value },
  });
};

const goHome = async (): Promise<void> => {
  await router.push({ name: "folders" });
};

const updateFolderSort = async (
  sort: FolderBrowseSort,
  order: FolderBrowseOrder,
): Promise<void> => {
  if (!currentPath.value) return;
  exitBatch();
  await router.replace({
    name: "folders",
    query: {
      ...route.query,
      path: currentPath.value,
      sort,
      order,
    },
  });
  settings.appearance.folderBrowseSort = sort;
  settings.appearance.folderBrowseOrder = order;
};

const handleFolderSort = (value: string | number | boolean): void => {
  const sort = parseFolderSort(String(value));
  if (!sort || sort === currentSort.value) return;
  void updateFolderSort(sort, defaultFolderOrder(sort));
};

const toggleFolderOrder = (): void => {
  const order: FolderBrowseOrder = currentOrder.value === "asc" ? "desc" : "asc";
  void updateFolderSort(currentSort.value, order);
};

const toggleContainer = async (entry: FolderBrowseEntry): Promise<void> => {
  if (entry.kind !== "cue" && entry.kind !== "sacd") return;
  const same = requestedContainerPath.value === entry.path;
  await router.push({
    name: "folders",
    query: {
      path: currentPath.value,
      sort: currentSort.value,
      order: currentOrder.value,
      ...(!same ? { container: entry.path } : {}),
    },
  });
};

const runAction = async (
  path: string,
  mode: "play" | "shuffle" | "play-next" | "queue",
  recursive = true,
): Promise<void> => {
  try {
    const result = await folderBrowserClient.play(path, mode, recursive);
    if (result.failed.length > 0) toast.warning(result.failed[0]);
    if (mode === "queue" && result.count > 0) toast.success(t("songList.toast.addedToQueue"));
    if (mode === "play-next" && result.count > 0) toast.success(t("songList.toast.addedToNext"));
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  }
};

const runBatchAction = async (mode: "play" | "play-next" | "queue"): Promise<void> => {
  const targets = batchSelectedTargets.value;
  if (targets.length === 0) return;
  try {
    const result = await folderBrowserClient.batchPlay(mode, targets);
    if (result.failed.length > 0) toast.warning(result.failed[0]);
    if (mode === "queue" && result.count > 0) toast.success(t("songList.toast.addedToQueue"));
    if (mode === "play-next" && result.count > 0) {
      toast.success(t("songList.toast.addedToNext"));
    }
    if (result.count > 0) exitBatch();
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  }
};

const playContainerTrack = (track: Track, mode: "play" | "play-next" | "queue"): void => {
  if (mode === "play") void player.playNow(track);
  else if (mode === "play-next") {
    void player.insertToQueue(track);
    toast.success(t("songList.toast.addedToNext"));
  } else {
    player.insertManyToQueue([track], "end");
    toast.success(t("songList.toast.addedToQueue"));
  }
};

const handleScan = async (incremental: boolean): Promise<void> => {
  if (!currentPath.value || scanning.value) return;
  try {
    await folderBrowserClient.scan(currentPath.value, incremental);
    toast.success(t("folder.scanStarted"));
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  }
};

const togglePin = async (): Promise<void> => {
  if (!currentPath.value) return;
  try {
    pins.value = currentPinned.value
      ? await folderBrowserClient.unpin(currentPath.value)
      : await folderBrowserClient.pin(currentPath.value);
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  }
};

const openCreatePlaylist = (targetPath: string, recursive: boolean): void => {
  createTargetPath.value = targetPath;
  createRecursive.value = recursive;
  createTargetTrack.value = null;
  createBatchTargets.value = null;
  playlistPickerOpen.value = true;
  if (!playlistStore.initialized) {
    void playlistStore.load().catch((value) =>
      toast.error(value instanceof Error ? value.message : String(value)),
    );
  }
};

const openContainerTrackPlaylist = (track: Track, containerPath: string): void => {
  createTargetPath.value = containerPath;
  createRecursive.value = false;
  createBatchTargets.value = null;
  createTargetTrack.value = {
    containerPath,
    trackId: track.id,
    title: track.title,
  };
  playlistPickerOpen.value = true;
  if (!playlistStore.initialized) {
    void playlistStore.load().catch((value) =>
      toast.error(value instanceof Error ? value.message : String(value)),
    );
  }
};

const openBatchPlaylist = (): void => {
  if (batchSelectedTargets.value.length === 0 || !currentPath.value) return;
  createTargetPath.value = currentPath.value;
  createRecursive.value = false;
  createTargetTrack.value = null;
  createBatchTargets.value = [...batchSelectedTargets.value];
  playlistPickerOpen.value = true;
  if (!playlistStore.initialized) {
    void playlistStore.load().catch((value) =>
      toast.error(value instanceof Error ? value.message : String(value)),
    );
  }
};

const openPlaylistCreate = (): void => {
  playlistPickerOpen.value = false;
  createOpen.value = true;
};

const addPlaylistTarget = async (playlistId: string): Promise<number> => {
  const batchTargets = createBatchTargets.value;
  const trackTarget = createTargetTrack.value;
  const result = batchTargets
    ? await folderBrowserClient.addBatchToPlaylist(playlistId, batchTargets)
    : trackTarget
      ? await folderBrowserClient.addContainerTrackToPlaylist(
          playlistId,
          trackTarget.containerPath,
          trackTarget.trackId,
        )
      : await folderBrowserClient.addToPlaylist(
          playlistId,
          createTargetPath.value,
          createRecursive.value,
        );
  await playlistStore.load();
  return result.added;
};

const handlePlaylistPick = async (playlistId: string): Promise<void> => {
  if (!createTargetPath.value || playlistSubmitting.value) return;
  playlistSubmitting.value = true;
  try {
    const wasBatch = !!createBatchTargets.value;
    const added = await addPlaylistTarget(playlistId);
    toast.success(t("collection.tracksAdded", { count: added }));
    playlistPickerOpen.value = false;
    createBatchTargets.value = null;
    if (wasBatch) exitBatch();
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  } finally {
    playlistSubmitting.value = false;
  }
};

const handleCreated = async (playlistId: string): Promise<void> => {
  if (!createTargetPath.value) return;
  try {
    const wasBatch = !!createBatchTargets.value;
    const added = await addPlaylistTarget(playlistId);
    toast.success(t("collection.tracksAdded", { count: added }));
    createBatchTargets.value = null;
    if (wasBatch) exitBatch();
  } catch (value) {
    toast.error(value instanceof Error ? value.message : String(value));
  }
};

const folderMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "batchManage",
    label: t("songList.batch.manage"),
    icon: IconListChecks,
    disabled: batchCandidates.value.length === 0,
  },
  {
    key: "shuffle",
    label: t("folder.shuffle"),
    icon: IconShuffle,
  },
  {
    key: "playNext",
    label: t("folder.playNext"),
    icon: IconListEnd,
  },
  {
    key: "queue",
    label: t("folder.queue"),
    icon: IconListMusic,
  },
  {
    key: "playlist",
    label: t("folder.addToPlaylist"),
    icon: IconListPlus,
  },
  {
    key: "currentOnly",
    label: t("folder.currentOnly"),
    icon: IconFolder,
    separator: true,
    children: [
      { key: "playCurrent", label: t("folder.play"), icon: IconPlay },
      { key: "playNextCurrent", label: t("folder.playNext"), icon: IconListEnd },
      { key: "queueCurrent", label: t("folder.queue"), icon: IconListMusic },
      { key: "playlistCurrent", label: t("folder.addToPlaylist"), icon: IconListPlus },
    ],
  },
  {
    key: "rescan",
    label: t("folder.rescan"),
    icon: IconRefreshCw,
    separator: true,
  },
  {
    key: currentPinned.value ? "unpin" : "pin",
    label: currentPinned.value ? t("folder.unpin") : t("folder.pin"),
    icon: currentPinned.value ? IconPinOff : IconPin,
  },
]);

const handleFolderMenu = (key: string): void => {
  if (key === "batchManage") enterBatch();
  else if (key === "playCurrent") void runAction(currentPath.value, "play", false);
  else if (key === "playNext") void runAction(currentPath.value, "play-next", true);
  else if (key === "playNextCurrent") void runAction(currentPath.value, "play-next", false);
  else if (key === "queue") void runAction(currentPath.value, "queue", true);
  else if (key === "queueCurrent") void runAction(currentPath.value, "queue", false);
  else if (key === "shuffle") void runAction(currentPath.value, "shuffle", true);
  else if (key === "playlist") openCreatePlaylist(currentPath.value, true);
  else if (key === "playlistCurrent") openCreatePlaylist(currentPath.value, false);
  else if (key === "rescan") void handleScan(false);
  else if (key === "pin" || key === "unpin") void togglePin();
};

const entryMenu = (entry: FolderBrowseEntry): DropdownMenuItem[] => {
  if (entry.kind === "material") return [];
  const directory = entry.kind === "directory";
  const pinned = directory && pins.value.some((item) => item.path === entry.path);
  return [
    { key: "play", label: t("folder.play"), icon: IconPlay },
    ...(directory ? [{ key: "shuffle", label: t("folder.shuffle"), icon: IconShuffle }] : []),
    { key: "playNext", label: t("folder.playNext"), icon: IconListEnd },
    { key: "queue", label: t("folder.queue"), icon: IconListMusic },
    {
      key: "playlist",
      label: t("folder.addToPlaylist"),
      icon: IconListPlus,
    },
    ...(directory
      ? [
          {
            key: "currentOnly",
            label: t("folder.currentOnly"),
            icon: IconFolder,
            separator: true,
            children: [
              { key: "playCurrent", label: t("folder.play"), icon: IconPlay },
              { key: "playNextCurrent", label: t("folder.playNext"), icon: IconListEnd },
              { key: "queueCurrent", label: t("folder.queue"), icon: IconListMusic },
              { key: "playlistCurrent", label: t("folder.addToPlaylist"), icon: IconListPlus },
            ],
          },
          {
            key: pinned ? "unpin" : "pin",
            label: pinned ? t("folder.unpin") : t("folder.pin"),
            icon: pinned ? IconPinOff : IconPin,
          },
        ]
      : []),
  ];
};

const handleEntryMenu = (entry: FolderBrowseEntry, key: string): void => {
  if (key === "play") void runAction(entry.path, "play", true);
  else if (key === "playCurrent") void runAction(entry.path, "play", false);
  else if (key === "shuffle") void runAction(entry.path, "shuffle", true);
  else if (key === "playNext") void runAction(entry.path, "play-next", true);
  else if (key === "playNextCurrent") void runAction(entry.path, "play-next", false);
  else if (key === "queue") void runAction(entry.path, "queue", true);
  else if (key === "queueCurrent") void runAction(entry.path, "queue", false);
  else if (key === "playlist") openCreatePlaylist(entry.path, true);
  else if (key === "playlistCurrent") openCreatePlaylist(entry.path, false);
  else if (key === "pin" || key === "unpin") {
    const request =
      key === "pin" ? folderBrowserClient.pin(entry.path) : folderBrowserClient.unpin(entry.path);
    void request
      .then((value) => (pins.value = value))
      .catch((value) => toast.error(value instanceof Error ? value.message : String(value)));
  }
};

const activateEntry = async (entry: FolderBrowseEntry): Promise<void> => {
  if (entry.kind === "directory") await goFolder(entry.path);
  else if (entry.kind === "cue" || entry.kind === "sacd") await toggleContainer(entry);
  else if (entry.kind === "material") await openMaterial(entry);
  else await runAction(entry.path, "play", false);
};

const openSearchResult = async (result: FolderSearchResult): Promise<void> => {
  if (result.kind === "directory") {
    await goFolder(result.path);
    searchQuery.value = "";
    return;
  }
  searchQuery.value = "";
  await router.push({
    name: "folders",
    query: {
      path: result.parent,
      sort: currentSort.value,
      order: currentOrder.value,
      focusPath: result.path,
    },
  });
};

const performSearch = useDebounceFn(async (query: string) => {
  const generation = ++searchGeneration;
  searchAbortController?.abort();
  searchAbortController = null;
  const value = query.trim();
  searchResults.value = [];
  searchCursor.value = undefined;
  if (!value) {
    searchLoading.value = false;
    return;
  }
  const controller = new AbortController();
  searchAbortController = controller;
  searchLoading.value = true;
  try {
    const result = await folderBrowserClient.search(value, undefined, 100, controller.signal);
    if (generation !== searchGeneration) return;
    searchResults.value = result.data;
    searchCursor.value = result.nextCursor;
  } catch (error) {
    if (generation === searchGeneration && !controller.signal.aborted)
      toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    if (generation === searchGeneration) {
      searchLoading.value = false;
      if (searchAbortController === controller) searchAbortController = null;
    }
  }
}, 250);

const loadMoreSearch = async (): Promise<void> => {
  if (!searchCursor.value || searchLoading.value || !searchQuery.value.trim()) return;
  const generation = searchGeneration;
  const query = searchQuery.value.trim();
  const controller = new AbortController();
  searchAbortController?.abort();
  searchAbortController = controller;
  searchLoading.value = true;
  try {
    const result = await folderBrowserClient.search(
      query,
      searchCursor.value,
      100,
      controller.signal,
    );
    if (generation !== searchGeneration || controller.signal.aborted) return;
    searchResults.value = [...searchResults.value, ...result.data];
    searchCursor.value = result.nextCursor;
  } catch (value) {
    if (generation === searchGeneration && !controller.signal.aborted) {
      toast.error(value instanceof Error ? value.message : String(value));
    }
  } finally {
    if (generation === searchGeneration) {
      searchLoading.value = false;
      if (searchAbortController === controller) searchAbortController = null;
    }
  }
};

watch(searchQuery, (value) => void performSearch(value));

const performFilter = useDebounceFn((value: string) => {
  if (!currentPath.value || value.trim() === loadedFilter.value) return;
  void loadCurrent(undefined, false);
}, 200);

watch(
  filterQuery,
  (value) => {
    if (ignoreFilterReload || !currentPath.value) return;
    folderFilters.set(currentPath.value, value);
    if (
      value.trim() === loadedFilter.value &&
      currentSort.value === loadedSort.value &&
      currentOrder.value === loadedOrder.value
    ) {
      return;
    }
    exitBatch();
    browseGeneration++;
    previousCursor.value = undefined;
    nextCursor.value = undefined;
    loadingMore.value = false;
    void performFilter(value);
  },
  { flush: "sync" },
);

const restoreFolderFilter = (path: string): void => {
  ignoreFilterReload = true;
  filterQuery.value = path ? (folderFilters.get(path) ?? "") : "";
  ignoreFilterReload = false;
};

const saveViewerState = (): void => {
  const material = viewerMaterial.value;
  if (!material) return;
  viewerStates.set(material.path, {
    page: pdfPage.value,
    zoom: pdfZoom.value,
    textScroll: textViewerRef.value?.scrollTop ?? 0,
  });
};

const openMaterial = async (material: FolderMaterialEntry): Promise<void> => {
  saveViewerState();
  viewerMaterial.value = material;
  const state = viewerStates.get(material.path);
  pdfPage.value = state?.page ?? 1;
  pdfZoom.value = state?.zoom ?? 100;
  viewerText.value = "";
  viewerTextTruncated.value = false;
  viewerOpen.value = true;
  if (material.materialType !== "text") return;
  viewerLoading.value = true;
  try {
    const result = await folderBrowserClient.readText(material.path);
    viewerText.value = result.text;
    viewerTextTruncated.value = result.truncated;
    await nextTick();
    if (state?.textScroll) textViewerRef.value?.scrollTo({ top: state.textScroll });
  } catch {
    toast.error(t("folder.materialLoadFailed"));
  } finally {
    viewerLoading.value = false;
  }
};

const stepViewerImage = (delta: number): void => {
  const index = viewerImageIndex.value;
  if (index < 0 || imageMaterials.value.length <= 1) return;
  const next = (index + delta + imageMaterials.value.length) % imageMaterials.value.length;
  const material = imageMaterials.value[next];
  if (material) viewerMaterial.value = material;
};

watch(viewerOpen, (open) => {
  if (!open) saveViewerState();
});

watch(
  () =>
    [
      currentPath.value,
      currentSort.value,
      currentOrder.value,
      requestedContainerPath.value,
      requestedFocusPath.value,
      requestedFocusId.value,
    ] as const,
  (next, previous) => {
    const [path, sort, order, containerPath, focusPath, focusId] = next;
    if (
      path &&
      (routeFolderSort.value !== sort || routeFolderOrder.value !== order)
    ) {
      void router.replace({
        name: "folders",
        query: { ...route.query, path, sort, order },
      });
      return;
    }

    const pathOrSortChanged =
      !previous ||
      path !== previous[0] ||
      sort !== previous[1] ||
      order !== previous[2];
    if (pathOrSortChanged) {
      exitBatch();
      restoreFolderFilter(path);
      void loadCurrent();
      return;
    }

    if (!path || path !== loadedPath.value || loading.value) return;
    const focusTarget = containerPath || focusPath;
    if (focusTarget && !entries.value.some((entry) => entry.path === focusTarget)) {
      void loadCurrent(focusTarget, false);
      return;
    }
    if (containerPath !== previous[3]) {
      void loadContainer();
      return;
    }
    if (focusPath !== previous[4] || focusId !== previous[5]) {
      void focusRequestedEntry();
    }
  },
  { immediate: true },
);

let unsubscribeScan: (() => void) | null = null;
let unsubscribeRevision: (() => void) | null = null;
let unsubscribePins: (() => void) | null = null;
let unsubscribeRoots: (() => void) | null = null;
const refreshOnRevision = useDebounceFn(() => {
  if (currentPath.value && !loading.value) void refreshCurrent();
}, 250);
const onLibraryRevision = (): void => {
  // 扫描自己的目录时，批次变化由 done 统一刷新；不要让 debounce 跨过 done 后再触发第二次刷新。
  if (scanCoversCurrent.value) return;
  refreshOnRevision();
};

onMounted(async () => {
  try {
    scanProgress.value = await folderBrowserClient.scanProgress();
  } catch {
    scanProgress.value = null;
  }
  unsubscribeScan = subscribeCoreControlEvent("libraryScanProgress", (progress) => {
    scanProgress.value = progress;
    if (
      progress.phase === "done" &&
      currentPath.value &&
      progress.scopeDirs?.some((scope) => folderPathWithinRoot(currentPath.value, scope))
    ) {
      void refreshCurrent();
    }
  });
  unsubscribeRevision = subscribeCoreControlEvent("libraryChanged", onLibraryRevision);
  unsubscribePins = subscribeCoreControlEvent("folderPinsChanged", () => {
    void loadRoots();
  });
  unsubscribeRoots = subscribeCoreControlEvent("libraryRootsChanged", (data) => {
    void loadRoots();
    if (!currentPath.value) return;
    if (!data.paths.some((root) => folderPathWithinRoot(currentPath.value, root))) {
      void router.replace({ name: "folders" });
      return;
    }
    if (!loading.value) void refreshCurrent();
  });
});

onBeforeUnmount(() => {
  searchAbortController?.abort();
  searchAbortController = null;
  saveCurrentScroll();
  saveViewerState();
  unsubscribeScan?.();
  unsubscribeRevision?.();
  unsubscribePins?.();
  unsubscribeRoots?.();
  if (highlightTimer !== null) window.clearTimeout(highlightTimer);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 px-5 pb-3">
      <div class="flex flex-wrap items-center gap-3 pt-2">
        <h1 class="text-3xl font-bold text-on-surface">{{ t("folder.label") }}</h1>
        <SInput
          v-if="!currentPath"
          v-model="searchQuery"
          :placeholder="t('folder.searchPlaceholder')"
          clearable
          round
          class="ml-auto w-full sm:w-72"
        >
          <template #prefix><IconSearch class="size-4 opacity-50" /></template>
        </SInput>
      </div>

      <div v-if="currentPath && !searchQuery.trim()" class="mt-3 flex min-w-0 items-center gap-1">
        <SButton variant="text" size="small" @click="goHome">
          <template #icon><IconFolder class="size-4" /></template>
          {{ t("folder.label") }}
        </SButton>
        <template v-for="item in breadcrumb" :key="item.path">
          <IconChevronRight class="size-3.5 shrink-0 opacity-35" />
          <button
            class="min-w-0 max-w-64 truncate rounded-md px-2 py-1 text-sm text-on-surface-variant hover:bg-primary/8"
            :title="item.path"
            @click="goFolder(item.path)"
          >
            {{ item.name }}
          </button>
        </template>
      </div>

      <div
        v-if="currentPath && !searchQuery.trim()"
        class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-solid border-primary/12 bg-surface-panel px-3 py-2"
      >
        <template v-if="batchActive">
          <SCheckbox
            :checked="batchAllSelected"
            :indeterminate="batchPartialSelected"
            size="small"
            @update:checked="toggleBatchAll"
          />
          <span class="shrink-0 text-sm tabular-nums text-on-surface-variant">
            {{ t("songList.batch.selected", { count: batchSelectedCount }) }}
          </span>
          <SDivider vertical />
          <SButton
            variant="ghost"
            size="small"
            :disabled="batchSelectedCount === 0"
            @click="invertBatchSelection"
          >
            <template #icon><IconArrowLeftRight class="size-3.5" /></template>
            {{ t("songList.batch.invert") }}
          </SButton>
          <SButton
            variant="ghost"
            size="small"
            :disabled="batchSelectedCount === 0"
            @click="runBatchAction('play')"
          >
            <template #icon><IconPlay class="size-3.5" /></template>
            {{ t("folder.play") }}
          </SButton>
          <SButton
            variant="ghost"
            size="small"
            :disabled="batchSelectedCount === 0"
            @click="runBatchAction('play-next')"
          >
            <template #icon><IconListEnd class="size-3.5" /></template>
            {{ t("folder.playNext") }}
          </SButton>
          <SButton
            variant="ghost"
            size="small"
            :disabled="batchSelectedCount === 0"
            @click="runBatchAction('queue')"
          >
            <template #icon><IconListMusic class="size-3.5" /></template>
            {{ t("folder.queue") }}
          </SButton>
          <SButton
            variant="ghost"
            size="small"
            :disabled="batchSelectedCount === 0"
            @click="openBatchPlaylist"
          >
            <template #icon><IconListPlus class="size-3.5" /></template>
            {{ t("folder.addToPlaylist") }}
          </SButton>
          <SDivider vertical />
          <SButton variant="ghost" size="small" @click="exitBatch">
            <template #icon><IconX class="size-3.5" /></template>
            {{ t("songList.batch.exit") }}
          </SButton>
        </template>
        <template v-else>
          <SButton
            type="primary"
            variant="secondary"
            size="small"
            round
            @click="runAction(currentPath, 'play', true)"
          >
            <template #icon><IconPlay /></template>
            {{ t("common.playAll") }}
          </SButton>
          <SButton
            variant="secondary"
            size="small"
            round
            :disabled="scanning"
            @click="handleScan(true)"
          >
            <template #icon>
              <IconRefreshCw :class="scanCoversCurrent ? 'animate-spin' : ''" />
            </template>
            {{ t("folder.scan") }}
          </SButton>
          <SDropdownMenu :items="folderMenuItems" align="start" @select="handleFolderMenu">
            <template #trigger>
              <SButton variant="secondary" circle size="small">
                <template #icon><IconEllipsis /></template>
              </SButton>
            </template>
          </SDropdownMenu>
          <SInput
            v-model="filterQuery"
            :placeholder="t('folder.filterPlaceholder')"
            clearable
            round
            class="ml-auto w-full sm:w-72"
          >
            <template #prefix><IconSearch class="size-4 opacity-50" /></template>
          </SInput>
          <SPopselect
            :model-value="currentSort"
            :options="folderSortOptions"
            align="end"
            @update:model-value="handleFolderSort"
          >
            <template #trigger="{ selected }">
              <SButton variant="secondary" size="small" round>
                <template #icon><IconArrowUpDown class="size-3.5" /></template>
                {{ selected?.label ?? t("folder.sortName") }}
              </SButton>
            </template>
          </SPopselect>
          <SButton
            variant="secondary"
            circle
            size="small"
            :title="t(currentOrder === 'asc' ? 'folder.sortAscending' : 'folder.sortDescending')"
            @click="toggleFolderOrder"
          >
            <template #icon>
              <IconArrowUp v-if="currentOrder === 'asc'" />
              <IconArrowDown v-else />
            </template>
          </SButton>
          <SButton
            variant="secondary"
            circle
            size="small"
            :title="t(folderViewMode === 'list' ? 'folder.gridView' : 'folder.listView')"
            @click="folderViewMode = folderViewMode === 'list' ? 'grid' : 'list'"
          >
            <template #icon>
              <IconLayoutGrid v-if="folderViewMode === 'list'" />
              <IconList v-else />
            </template>
          </SButton>
          <div
            v-if="scanCoversCurrent && scanProgress"
            class="text-xs tabular-nums text-on-surface-variant/60"
          >
            {{ scanProgress.scanned }}/{{ scanProgress.total || "—" }}
          </div>
        </template>
      </div>
    </div>

    <div class="min-h-0 flex-1">
      <div
        v-if="!currentPath && searchQuery.trim()"
        class="h-full min-h-0 overflow-y-auto px-5 pb-5"
      >
        <div class="mb-3 text-sm font-medium text-on-surface-variant">
          {{ t("folder.searchResults") }}
        </div>
        <div
          v-for="result in searchResults"
          :key="result.path"
          class="mb-1 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-primary/8"
          @click="openSearchResult(result)"
        >
          <IconFolder v-if="result.kind === 'directory'" class="size-5 shrink-0 text-primary" />
          <IconFile v-else class="size-5 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ result.name }}</div>
            <div class="truncate text-xs text-on-surface-variant/50">{{ result.path }}</div>
          </div>
          <IconChevronRight class="size-4 shrink-0 opacity-30" />
        </div>
        <div
          v-if="!searchLoading && searchResults.length === 0"
          class="flex h-48 items-center justify-center text-sm text-on-surface-variant/50"
        >
          {{ t("folder.searchEmpty") }}
        </div>
        <div class="flex justify-center py-4">
          <SLoading v-if="searchLoading" />
          <SButton v-else-if="searchCursor" variant="secondary" @click="loadMoreSearch">
            {{ t("folder.loadMore") }}
          </SButton>
        </div>
      </div>

      <div v-else-if="loading" class="flex h-full items-center justify-center">
        <SLoading class="text-3xl text-primary/70" />
      </div>

      <div v-else-if="error" class="flex h-full items-center justify-center px-6">
        <div class="max-w-lg text-center">
          <div class="mb-4 break-all text-sm text-red-500/80">{{ error }}</div>
          <SButton variant="secondary" @click="loadCurrent">{{ t("common.retry") }}</SButton>
        </div>
      </div>

      <div v-else-if="!currentPath" class="h-full overflow-y-auto px-5 pb-6">
        <section v-if="pins.length > 0" class="mb-7">
          <h2 class="mb-2 text-sm font-semibold text-on-surface-variant">
            {{ t("folder.pinned") }}
          </h2>
          <button
            v-for="item in pins"
            :key="item.path"
            class="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-primary/8"
            @click="goFolder(item.path)"
          >
            <IconPin class="size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <div class="line-clamp-2 break-words text-sm font-medium">{{ item.name }}</div>
              <div class="truncate text-xs text-on-surface-variant/50">{{ item.path }}</div>
            </div>
            <span v-if="!item.available" class="text-xs text-amber-500">
              {{ t("folder.unavailable") }}
            </span>
            <IconChevronRight class="size-4 shrink-0 opacity-30" />
          </button>
        </section>

        <section v-if="roots.length > 0">
          <h2 class="mb-2 text-sm font-semibold text-on-surface-variant">
            {{ t("folder.roots") }}
          </h2>
          <button
            v-for="item in roots"
            :key="item.path"
            class="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-primary/8"
            @click="goFolder(item.path)"
          >
            <IconFolderOpen class="size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <div class="line-clamp-2 break-words text-sm font-medium">{{ item.name }}</div>
              <div class="truncate text-xs text-on-surface-variant/50">{{ item.path }}</div>
            </div>
            <span v-if="!item.available" class="text-xs text-amber-500">
              {{ t("folder.unavailable") }}
            </span>
            <IconChevronRight class="size-4 shrink-0 opacity-30" />
          </button>
        </section>

        <div v-else class="flex h-full items-center justify-center">
          <div class="text-center text-on-surface-variant/50">
            <IconFolder class="mx-auto mb-3 size-12 opacity-30" />
            <div class="mb-1 text-sm">{{ t("library.noLocalSongs") }}</div>
            <div class="mb-4 text-xs opacity-70">{{ t("library.configureHint") }}</div>
            <SButton
              type="primary"
              variant="secondary"
              @click="settingsDialog.show('localLibrary')"
            >
              <template #icon><IconSettings2 /></template>
              {{ t("library.openSettings") }}
            </SButton>
          </div>
        </div>
      </div>

      <div v-else-if="page?.unavailable" class="flex h-full items-center justify-center px-6">
        <div class="text-center text-on-surface-variant/60">
          <IconFolder class="mx-auto mb-3 size-12 opacity-30" />
          <div class="mb-2 text-sm">{{ t("folder.unavailable") }}</div>
          <div class="mb-4 max-w-lg break-all text-xs opacity-70">{{ currentPath }}</div>
          <SButton variant="secondary" @click="refreshCurrent">{{ t("common.retry") }}</SButton>
        </div>
      </div>

      <SVirtualList
        v-else
        ref="listRef"
        :items="viewRows"
        :item-height="64"
        :get-item-key="(row: ViewRow) => row.key"
        :padding-bottom="24"
        @reach-bottom="loadMore"
      >
        <template #header>
          <div v-if="previousCursor" class="flex justify-center pb-2">
            <SButton variant="secondary" size="small" :disabled="loadingMore" @click="loadPrevious">
              {{ t("folder.loadPrevious") }}
            </SButton>
          </div>
        </template>
        <template #default="{ item }">
          <div
            v-if="item.kind === 'section'"
            class="flex h-10 items-end justify-between px-5 pb-1 text-xs font-semibold text-on-surface-variant/65"
          >
            <span>{{ item.label }}</span>
            <span class="tabular-nums font-normal opacity-60">{{ item.count }}</span>
          </div>

          <section v-else-if="item.kind === 'directory-grid'" class="px-5 py-2">
            <div
              class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
            >
              <div
                v-for="entry in item.entries"
                :key="entry.path"
                class="group relative min-w-0 rounded-xl border border-solid border-primary/10 bg-surface-panel transition-colors hover:bg-primary/6"
              >
                <button
                  class="block w-full min-w-0 p-3 text-left"
                  :class="batchActive ? 'cursor-default opacity-60' : ''"
                  @click="batchActive ? undefined : activateEntry(entry)"
                >
                  <div
                    class="relative mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-primary/8 text-primary"
                  >
                    <IconFolder class="size-12 opacity-80" />
                    <img
                      v-if="!directoryThumbnailFailures.has(entry.path)"
                      :src="folderBrowserClient.directoryThumbnailUrl(entry.path)"
                      :alt="entry.name"
                      class="absolute inset-0 size-full object-cover"
                      loading="lazy"
                      @error="markDirectoryThumbnailFailed(entry.path)"
                    />
                  </div>
                  <div class="line-clamp-2 min-h-10 break-words text-sm font-medium">
                    {{ entry.name }}
                  </div>
                </button>
                <div v-if="!batchActive" class="absolute right-2 top-2">
                  <SDropdownMenu
                    :items="entryMenu(entry)"
                    align="end"
                    @select="(key: string) => handleEntryMenu(entry, key)"
                  >
                    <template #trigger>
                      <SButton variant="secondary" circle size="small" class="opacity-90">
                        <template #icon><IconEllipsis /></template>
                      </SButton>
                    </template>
                  </SDropdownMenu>
                </div>
              </div>
            </div>
          </section>

          <div
            v-else-if="item.kind === 'container-track'"
            class="mx-5 flex min-h-14 items-center gap-3 border-0 border-l-2 border-solid border-primary/20 px-4 py-2 transition-colors"
            :class="[
              highlightKey === item.key ? 'bg-primary/12' : 'hover:bg-primary/6',
              batchActive && batchSelectedKeys.has(item.key) ? 'bg-primary/10' : '',
            ]"
            @click="batchActive ? toggleBatchKey(item.key) : undefined"
          >
            <SCheckbox
              v-if="batchActive"
              :checked="batchSelectedKeys.has(item.key)"
              size="small"
              @update:checked="toggleBatchKey(item.key)"
              @click.stop
            />
            <IconMusic v-else class="size-4 shrink-0 text-primary/70" />
            <button
              class="min-w-0 flex-1 text-left"
              @dblclick="batchActive ? undefined : playContainerTrack(item.track, 'play')"
            >
              <div class="truncate text-sm font-medium">{{ item.track.title }}</div>
              <div class="truncate text-xs text-on-surface-variant/50">
                {{ item.track.artists.map((artist) => artist.name).join(" / ") }}
              </div>
            </button>
            <SButton
              v-if="!batchActive"
              variant="text"
              circle
              size="small"
              @click="playContainerTrack(item.track, 'play')"
            >
              <template #icon><IconPlay /></template>
            </SButton>
            <SDropdownMenu
              v-if="!batchActive"
              :items="[
                { key: 'playNext', label: t('folder.playNext'), icon: IconListEnd },
                { key: 'queue', label: t('folder.queue'), icon: IconListMusic },
                { key: 'playlist', label: t('folder.addToPlaylist'), icon: IconListPlus },
              ]"
              align="end"
              @select="
                (key: string) =>
                  key === 'playlist'
                    ? openContainerTrackPlaylist(item.track, item.containerPath)
                    : playContainerTrack(item.track, key === 'playNext' ? 'play-next' : 'queue')
              "
            >
              <template #trigger>
                <SButton variant="text" circle size="small">
                  <template #icon><IconEllipsis /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>

          <div
            v-else
            class="mx-3 flex min-h-16 items-center gap-3 rounded-xl px-3 py-2 transition-colors"
            :class="[
              highlightKey === item.key ? 'bg-primary/12' : 'hover:bg-primary/6',
              batchActive && batchSelectedKeys.has(item.key) ? 'bg-primary/10' : '',
            ]"
            @click="
              batchActive &&
              item.entry.kind !== 'directory' &&
              item.entry.kind !== 'material'
                ? toggleBatchKey(item.key)
                : undefined
            "
          >
            <SCheckbox
              v-if="
                batchActive &&
                item.entry.kind !== 'directory' &&
                item.entry.kind !== 'material'
              "
              :checked="batchSelectedKeys.has(item.key)"
              size="small"
              @update:checked="toggleBatchKey(item.key)"
              @click.stop
            />
            <template v-if="item.entry.kind === 'material' && materialHasThumbnail(item.entry)">
              <img
                :src="folderBrowserClient.thumbnailUrl(item.entry.path)"
                class="size-11 shrink-0 rounded-lg object-cover bg-primary/5"
                loading="lazy"
              />
            </template>
            <IconFolder
              v-else-if="item.entry.kind === 'directory'"
              class="size-6 shrink-0 text-primary"
            />
            <IconDisc3
              v-else-if="item.entry.kind === 'cue' || item.entry.kind === 'sacd'"
              class="size-6 shrink-0 text-primary"
            />
            <IconImage
              v-else-if="item.entry.kind === 'material' && item.entry.materialType === 'image'"
              class="size-6 shrink-0 text-primary"
            />
            <IconFileText
              v-else-if="item.entry.kind === 'material'"
              class="size-6 shrink-0 text-primary"
            />
            <IconFileAudio v-else class="size-6 shrink-0 text-primary" />

            <button
              class="min-w-0 flex-1 text-left"
              :class="
                batchActive &&
                (item.entry.kind === 'directory' || item.entry.kind === 'material')
                  ? 'cursor-default opacity-60'
                  : ''
              "
              @click="
                batchActive
                  ? undefined
                  : activateEntry(item.entry)
              "
            >
              <div class="line-clamp-2 break-words text-sm font-medium">
                {{ item.entry.kind === "track" ? item.entry.track.title : item.entry.name }}
              </div>
              <div class="mt-0.5 truncate text-xs text-on-surface-variant/50">
                <template v-if="item.entry.kind === 'track'">
                  {{ item.entry.track.artists.map((artist) => artist.name).join(" / ") }}
                  <span v-if="item.entry.track.album?.name">
                    · {{ item.entry.track.album.name }}
                  </span>
                </template>
                <template v-else-if="item.entry.kind === 'file'">
                  {{ formatFileSize(item.entry.size) }}
                </template>
                <template v-else-if="item.entry.kind === 'cue' || item.entry.kind === 'sacd'">
                  {{
                    item.entry.trackCount
                      ? t("common.totalSongs", { count: item.entry.trackCount })
                      : item.entry.path
                  }}
                </template>
                <template v-else-if="item.entry.kind === 'material'">
                  {{ formatFileSize(item.entry.size) }}
                </template>
                <template v-else>{{ item.entry.path }}</template>
              </div>
            </button>

            <IconChevronRight
              v-if="item.entry.kind === 'directory' && !batchActive"
              class="size-4 shrink-0 opacity-30"
            />
            <SButton
              v-else-if="item.entry.kind !== 'material' && !batchActive"
              variant="text"
              circle
              size="small"
              @click="runAction(item.entry.path, 'play', false)"
            >
              <template #icon><IconPlay /></template>
            </SButton>
            <SDropdownMenu
              v-if="!batchActive && entryMenu(item.entry).length"
              :items="entryMenu(item.entry)"
              align="end"
              @select="(key: string) => handleEntryMenu(item.entry, key)"
            >
              <template #trigger>
                <SButton variant="text" circle size="small">
                  <template #icon><IconEllipsis /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>
        </template>

        <template #empty>
          <div class="text-center text-on-surface-variant/50">
            <IconMusic class="mx-auto mb-3 size-10 opacity-30" />
            <div class="text-sm">
              {{ filterQuery.trim() ? t("folder.filterEmpty") : t("folder.empty") }}
            </div>
          </div>
        </template>

        <template #footer>
          <div class="flex justify-center py-4">
            <SLoading v-if="loadingMore" />
            <SButton v-else-if="nextCursor" variant="secondary" @click="loadMore">
              {{ t("folder.loadMore") }}
            </SButton>
          </div>
        </template>
      </SVirtualList>
    </div>

    <SDialog
      v-model:open="playlistPickerOpen"
      :title="t('collection.addTo', { type: t('collection.playlist') })"
      width="420px"
    >
      <div class="flex max-h-96 flex-col overflow-y-auto">
        <button
          class="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-on-surface/5"
          @click="openPlaylistCreate"
        >
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <IconListPlus class="size-5" />
          </div>
          <span class="text-sm text-on-surface">
            {{ t("collection.create", { type: t("collection.playlist") }) }}
          </span>
        </button>
        <button
          v-for="item in playlistStore.localPlaylists"
          :key="item.id"
          class="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-on-surface/5"
          :class="playlistSubmitting ? 'pointer-events-none opacity-50' : ''"
          @click="handlePlaylistPick(item.id)"
        >
          <SImg :src="item.cover" :alt="item.title" class="size-12 shrink-0 rounded-md" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-on-surface">{{ item.title }}</div>
            <div class="text-xs tabular-nums text-on-surface-variant/60">
              {{ t("common.totalSongs", { count: item.trackCount }) }}
            </div>
          </div>
        </button>
      </div>
    </SDialog>

    <PlaylistCreateDialog
      v-model:open="createOpen"
      mode="local"
      :initial-name="
        createTargetTrack?.title || createTargetPath.split(/[/\\]/).filter(Boolean).pop()
      "
      @created="handleCreated"
    />

    <SDialog
      v-model:open="viewerOpen"
      :title="viewerMaterial?.name || t('folder.materials')"
      width="min(1000px, calc(100vw - 32px))"
    >
      <div v-if="viewerMaterial" class="h-[min(72vh,760px)] min-h-72">
        <div
          v-if="viewerMaterial.materialType === 'image'"
          class="relative flex h-full items-center justify-center overflow-auto bg-black/5"
        >
          <SButton
            v-if="imageMaterials.length > 1"
            variant="secondary"
            circle
            class="absolute left-3 z-10"
            @click="stepViewerImage(-1)"
          >
            <template #icon><IconChevronLeft /></template>
          </SButton>
          <img
            :src="folderBrowserClient.materialUrl(viewerMaterial.path)"
            class="max-h-full max-w-full object-contain"
          />
          <div
            v-if="imageMaterials.length > 1"
            class="absolute bottom-3 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white"
          >
            {{ viewerImageIndex + 1 }} / {{ imageMaterials.length }}
          </div>
          <SButton
            v-if="imageMaterials.length > 1"
            variant="secondary"
            circle
            class="absolute right-3 z-10"
            @click="stepViewerImage(1)"
          >
            <template #icon><IconChevronRight /></template>
          </SButton>
        </div>
        <div v-else-if="viewerMaterial.materialType === 'pdf'" class="flex h-full flex-col">
          <div class="mb-2 flex items-center justify-end gap-2">
            <SButton
              variant="secondary"
              circle
              size="small"
              :disabled="pdfPage <= 1"
              @click="pdfPage--"
            >
              <template #icon><IconChevronLeft /></template>
            </SButton>
            <span class="min-w-12 text-center text-xs tabular-nums">{{ pdfPage }}</span>
            <SButton variant="secondary" circle size="small" @click="pdfPage++">
              <template #icon><IconChevronRight /></template>
            </SButton>
            <SDivider vertical class="mx-1 h-5" />
            <SButton
              variant="secondary"
              circle
              size="small"
              :disabled="pdfZoom <= 50"
              @click="pdfZoom = Math.max(50, pdfZoom - 10)"
            >
              <template #icon><IconZoomOut /></template>
            </SButton>
            <span class="min-w-12 text-center text-xs tabular-nums">{{ pdfZoom }}%</span>
            <SButton
              variant="secondary"
              circle
              size="small"
              :disabled="pdfZoom >= 200"
              @click="pdfZoom = Math.min(200, pdfZoom + 10)"
            >
              <template #icon><IconZoomIn /></template>
            </SButton>
          </div>
          <iframe :key="pdfUrl" :src="pdfUrl" class="min-h-0 flex-1 border-0 rounded-lg" />
        </div>
        <div v-else class="flex h-full flex-col">
          <div v-if="viewerTextTruncated" class="mb-2 text-xs text-amber-600">
            {{ t("folder.textTruncated", { size: formatFileSize(viewerMaterial.size) }) }}
          </div>
          <div ref="textViewerRef" class="min-h-0 flex-1 overflow-auto rounded-lg bg-primary/5 p-4">
            <SLoading v-if="viewerLoading" class="mx-auto mt-16" />
            <pre v-else class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5">{{
              viewerText
            }}</pre>
          </div>
        </div>
      </div>
    </SDialog>
  </div>
</template>
