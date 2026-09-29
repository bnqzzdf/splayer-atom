<script setup lang="ts">
import type {
  Artist,
  AudioQuality,
  PlaybackContext,
  Track,
  TrackSource,
} from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import { createControlAction, type ControlAction } from "@/actions/model";
import { controlActionsToMenuItems } from "@/actions/menu";
import { folderBrowserClient } from "@/core/folderBrowserClient";
import { loadCollection as loadCollectionService } from "@/services/collection";
import { getCollectionShareUrl } from "@/utils/format/shareUrl";
import { htmlToText } from "@/utils/format/html";
import { canNavigateToResource, navigateToArtist } from "@/utils/navigate";
import { useCopyText } from "@/composables/useCopyText";
import { useCollectionSubscribe } from "@/composables/collection/useCollectionSubscribe";
import { usePlaylistManage } from "@/composables/collection/usePlaylistManage";
import { buildDownloadQualityItems, useDownload } from "@/composables/useDownload";
import { toast } from "@/composables/useToast";
import { useSettingsStore } from "@/stores/settings";
import { getQualityLabel, type QualityLevel } from "@/utils/quality";
import SongList from "@/components/list/SongList.vue";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconCopy from "~icons/lucide/copy";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucideListEnd from "~icons/lucide/list-end";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { copy } = useCopyText();
const { enqueueMany: enqueueDownloads } = useDownload();
const settings = useSettingsStore();

const source = route.params.source as TrackSource;
const type = route.params.type as CollectionType;
const id = route.params.id as string;

const collection = shallowRef<Collection | null>(null);
/** 正在加载 */
const loading = ref(false);
/** 错误信息 */
const error = ref("");
/** 取消当次加载 */
let loadAbort: AbortController | null = null;

/** 折叠状态 */
const collapsed = ref(false);
/** 简介弹窗 */
const descriptionOpen = ref(false);
/** 多目录专辑的目录选择弹窗 */
const folderChoiceOpen = ref(false);
/** 正在解析本地专辑所在目录 */
const folderOpening = ref(false);
/** 多目录专辑可跳转的目录 */
const folderChoices = shallowRef<string[]>([]);
/** 多碟专辑当前浏览范围；"all" 表示整张专辑。 */
const selectedDisc = ref("all");

/**
 * 简介正文。
 *
 * 各平台（Qobuz/TIDAL/网易云）的 description 可能带 HTML 标签，
 * 渲染侧统一转成纯文本——既保留段落结构，又不引入 v-html 的注入面。
 */
const descriptionText = computed(() => htmlToText(collection.value?.description));

/** 滚动超过阈值折叠 */
const handleListScroll = (event: Event) => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 10) {
    collapsed.value = true;
  } else if (collapsed.value && scrollTop === 0) {
    collapsed.value = false;
  }
};

/** 加载数据 */
const loadCollection = async (): Promise<void> => {
  collapsed.value = false;
  loadAbort?.abort();
  const myAbort = new AbortController();
  loadAbort = myAbort;
  loading.value = true;
  error.value = "";

  try {
    await loadCollectionService(source, type, id, {
      fallbackName: typeof route.query.name === "string" ? route.query.name : undefined,
      signal: myAbort.signal,
      onUpdate: (next) => {
        if (myAbort.signal.aborted) return;
        collection.value = next;
      },
    });
  } catch (err) {
    if (myAbort.signal.aborted) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

/**
 * 乐观过滤本地 tracks
 * @param removedIds 已成功删除的曲目 id 列表
 */
const handleTracksRemoved = (removedIds: string[]): void => {
  if (!collection.value || removedIds.length === 0) return;
  const removed = new Set(removedIds);
  const tracks = collection.value.tracks.filter((track) => !removed.has(track.id));
  collection.value = {
    ...collection.value,
    tracks,
    trackCount: tracks.length,
  };
};

const typeLabel = computed(() => {
  const map: Record<CollectionType, string> = {
    album: t("collection.album"),
    playlist: t("collection.playlist"),
    radio: t("collection.radio"),
    cloud: t("cloud.title"),
    rank: t("collection.rank"),
  };
  return map[type] ?? "";
});

/** 总时长 */
const totalDuration = computed(() => {
  if (!collection.value) return "";
  const total = collection.value.tracks.reduce((sum, t) => sum + t.duration, 0);
  return total > 0 ? formatTime(total) : "";
});

/** 歌手文本 */
const artistText = computed(() => {
  if (!collection.value?.artists?.length) return "";
  return collection.value.artists.map((a) => a.name).join(" / ");
});

/** 歌手或创建者 */
const creatorText = computed(() => {
  return artistText.value || collection.value?.creator || "";
});

/** 专辑发行年份：只有整张专辑能得到单一年份时才展示，避免给混杂标签一个错误结论。 */
const albumYear = computed(() => {
  if (type !== "album" || !collection.value) return "";
  const years = new Set(
    collection.value.tracks
      .map((track) => track.album?.year)
      .filter(
        (year): year is number => typeof year === "number" && Number.isInteger(year) && year > 0,
      ),
  );
  return years.size === 1 ? String([...years][0]) : "";
});

/** 专辑碟数；未写 disc 标签的曲目按第一碟处理。 */
const trackDiscNumber = (track: Track): number =>
  Number.isInteger(track.disc) && (track.disc ?? 0) > 0 ? track.disc! : 1;

const discCount = computed(() => {
  if (type !== "album" || !collection.value?.tracks.length) return 0;
  return new Set(collection.value.tracks.map(trackDiscNumber)).size;
});

/** 多碟专辑浏览筛选；按真实 disc 编号排序，不重新编号。 */
const discOptions = computed(() => {
  if (type !== "album" || !collection.value?.tracks.length) return [];
  const counts = new Map<number, number>();
  for (const track of collection.value.tracks) {
    const disc = trackDiscNumber(track);
    counts.set(disc, (counts.get(disc) ?? 0) + 1);
  }
  if (counts.size <= 1) return [];
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([disc, count]) => ({ disc, count }));
});

const visibleTracks = computed(() => {
  const tracks = collection.value?.tracks ?? [];
  if (selectedDisc.value === "all") return tracks;
  const disc = Number(selectedDisc.value);
  return tracks.filter((track) => trackDiscNumber(track) === disc);
});

watch(discOptions, (options) => {
  if (
    selectedDisc.value !== "all" &&
    !options.some((option) => String(option.disc) === selectedDisc.value)
  ) {
    selectedDisc.value = "all";
  }
});

const formatSampleRate = (sampleRate: number): string => {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return "";
  if (sampleRate >= 1_000_000) {
    return `${(sampleRate / 1_000_000).toFixed(2).replace(/\.0+$/, "")} MHz`;
  }
  const khz = sampleRate / 1000;
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
};

/** 把单曲已有的 AudioQuality 压缩成适合专辑头部的一行事实文本。 */
const formatAudioQuality = (quality: AudioQuality | undefined): string => {
  if (!quality) return "";
  const display = getQualityLabel(quality);
  if (display.startsWith("DSD") || ["SACD", "MQA", "HDCD", "DTS", "MIDI"].includes(display)) {
    return display;
  }
  const codec = quality.codec?.trim();
  const details = [
    quality.bitsPerSample > 0 ? `${quality.bitsPerSample} bit` : "",
    formatSampleRate(quality.sampleRate),
  ].filter(Boolean);
  return [codec && codec !== "unknown" ? codec.toUpperCase() : "", details.join(" / ")]
    .filter(Boolean)
    .join(" · ");
};

/** 专辑统一音频规格；出现多种规格时不选一个“代表值”。 */
const qualitySummary = computed(() => {
  if (type !== "album" || !collection.value?.tracks.length) return "";
  const values = new Set(
    collection.value.tracks.map((track) => formatAudioQuality(track.quality)).filter(Boolean),
  );
  if (values.size === 0) return "";
  if (values.size === 1) return [...values][0] ?? "";
  return t("collection.multipleAudioFormats");
});

/** 来源名称用于事实信息，不再用右上角图标重复表达“这是专辑”。 */
const sourceText = computed(() => {
  switch (source) {
    case "local":
      return t("collection.scope.local");
    case "streaming":
      return "Streaming";
    case "qobuz":
      return "Qobuz";
    case "tidal":
      return "TIDAL";
    case "qqmusic":
      return "QQ";
    case "kugou":
      return "酷狗";
    case "netease":
      return "网易";
    default:
      return String(source).toUpperCase();
  }
});

/** 更新时间文本 */
const updateTimeText = computed(() => {
  if (!collection.value?.updateTime) return "";
  return new Date(collection.value.updateTime).toLocaleDateString();
});

/** 第一行事实：专辑优先展示发行信息，其余合集保留原有数量/时长信息。 */
const primaryFacts = computed(() => {
  if (!collection.value) return [];
  const facts: string[] = [];
  if (type === "album") {
    if (albumYear.value) facts.push(albumYear.value);
    if (discCount.value > 0) facts.push(t("collection.totalDiscs", { count: discCount.value }));
  }
  facts.push(t("common.totalSongs", { count: collection.value.tracks.length }));
  if (totalDuration.value) facts.push(t("collection.totalDuration", { time: totalDuration.value }));
  if (type !== "album" && updateTimeText.value) facts.push(updateTimeText.value);
  return facts;
});

/** 第二行事实：音频规格与来源。 */
const secondaryFacts = computed(() =>
  [type === "album" ? qualitySummary.value : "", sourceText.value].filter(Boolean),
);

const canOpenArtist = (artist: Artist): boolean =>
  canNavigateToResource({
    type: "artist",
    source,
    id: artist.id,
    name: artist.name,
  });

const openArtist = (artist: Artist): void => {
  navigateToArtist(artist.name, { source, artistId: artist.id });
};

const playbackContext = computed<PlaybackContext | undefined>(() => {
  const current = collection.value;
  if (!current || current.type === "cloud") return undefined;
  return {
    provider: current.source,
    originId: current.id,
    originType: current.type,
    originName: current.title,
  };
});

const handlePlayAll = () => {
  if (!collection.value?.tracks.length) return;
  player.playFrom(collection.value.tracks, 0, playbackContext.value);
};

const handleAddToQueue = (): void => {
  if (!collection.value?.tracks.length) return;
  const count = player.insertManyToQueue(collection.value.tracks, "end", playbackContext.value);
  if (count > 0) toast.success(t("collection.queueAdded", { count }));
  else toast.warning(t("collection.queueAllPresent"));
};

/**
 * 取一个只用于减少 location 请求的目录提示。
 * Core 仍通过 folderBrowserClient.location 决定真实可导航目录；这里不复制 CUE/SACD 规则。
 */
const folderHint = (track: Track): string => {
  const candidate = track.cuePath ?? track.path ?? track.cueAudioPath ?? track.id;
  const slash = Math.max(candidate.lastIndexOf("/"), candidate.lastIndexOf("\\"));
  return slash >= 0 ? candidate.slice(0, slash) : candidate;
};

const folderName = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return normalized.slice(slash + 1) || normalized || path;
};

const openFolderPath = (path: string): void => {
  folderChoiceOpen.value = false;
  void router.push({ name: "folders", query: { path } });
};

/** 专辑级“打开所在文件夹”：单目录直接进入，多目录才让用户选择。 */
const handleOpenAlbumFolder = async (): Promise<void> => {
  const current = collection.value;
  if (!current || source !== "local" || type !== "album" || folderOpening.value) return;

  const representatives = new Map<string, Track>();
  for (const track of current.tracks) {
    const hint = folderHint(track);
    if (!representatives.has(hint)) representatives.set(hint, track);
  }
  if (representatives.size === 0) return;

  folderOpening.value = true;
  try {
    const resolved = await Promise.all(
      [...representatives.values()].map(async (track) => {
        try {
          return await folderBrowserClient.location(track);
        } catch {
          return null;
        }
      }),
    );
    const paths = [...new Set(resolved.flatMap((target) => (target?.path ? [target.path] : [])))];
    if (paths.length === 0) {
      toast.error(t("folder.openContainingFailed"));
      return;
    }
    if (paths.length === 1) {
      openFolderPath(paths[0]!);
      return;
    }
    folderChoices.value = paths;
    folderChoiceOpen.value = true;
  } finally {
    folderOpening.value = false;
  }
};

const downloadQualityItems = computed(() =>
  buildDownloadQualityItems(t("download.qualityDefault"), "download-album:"),
);

const handleDownloadAlbum = (key: string): void => {
  if (!collection.value || source === "local") return;
  const quality = key.slice("download-album:".length);
  void enqueueDownloads(collection.value.tracks, {
    quality: quality ? (quality as QualityLevel) : undefined,
  });
};

const downloadAlbumAction = computed(() =>
  createControlAction({
    id: "downloadAlbum",
    label: t("collection.downloadAlbum"),
    icon: markRaw(IconLucideDownload),
    visible: type === "album" && source !== "local" && settings.system.download.enabled,
    enabled: !!collection.value?.tracks.length,
    coreCommand: "download.start-many",
    children: downloadQualityItems.value.map((item) =>
      createControlAction({ id: item.key, label: item.label, coreCommand: "download.start-many" }),
    ),
  }),
);

const searchQuery = ref("");

/** 歌曲列表引用 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 收藏 / 取消收藏 */
const subscribe = useCollectionSubscribe(collection);

/** 歌单管理：编辑 + 删除 */
const manage = usePlaylistManage(collection, {
  onEdited: () => loadCollection(),
  onDeleted: () => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  },
});

/** Collection 主动作与 header `...` 共用同一语义模型。 */
const editLabel = computed(() => t("collection.edit", { type: typeLabel.value }));

const collectionActions = computed<ControlAction[]>(() => {
  const isOnline = source !== "local" && source !== "streaming";
  const isLocal = source === "local";
  const manageCommandPrefix = isLocal ? "playlist" : "provider.playlist";
  return [
    createControlAction({
      id: "playAll",
      label: t("common.playAll"),
      enabled: !!collection.value?.tracks.length,
      coreCommand: "player.playFrom",
    }),
    createControlAction({
      id: "addToQueue",
      label: t("collection.addToQueue"),
      icon: markRaw(IconLucideListEnd),
      enabled: !!collection.value?.tracks.length,
      coreCommand: "player.insertQueueEnd",
    }),
    createControlAction({
      id: "toggleSubscribe",
      label: t(subscribe.isSubscribed.value ? "collection.unsubscribe" : "collection.subscribe"),
      visible: subscribe.available.value,
      enabled: !subscribe.busy.value,
      coreCommand: "provider.collection.subscribe",
    }),
    createControlAction({
      id: "batchManage",
      label: t("songList.batch.manage"),
      icon: markRaw(IconLucideListChecks),
      enabled: !!collection.value?.tracks.length,
    }),
    downloadAlbumAction.value,
    createControlAction({
      id: "openContainingFolder",
      label: t("folder.openContaining"),
      icon: markRaw(IconLucideFolderOpen),
      visible: source === "local" && type === "album",
      enabled: !!collection.value?.tracks.length && !folderOpening.value,
    }),
    createControlAction({
      id: "edit",
      label: editLabel.value,
      icon: markRaw(IconLucidePencil),
      visible: manage.canManage.value,
      coreCommand: `${manageCommandPrefix}.update`,
    }),
    createControlAction({
      id: "delete",
      label: t("collection.delete", { type: typeLabel.value }),
      icon: markRaw(IconLucideTrash2),
      separator: true,
      visible: manage.canManage.value,
      danger: true,
      coreCommand: `${manageCommandPrefix}.delete`,
    }),
    createControlAction({
      id: "copyTitle",
      label: t(`collection.context.${type}.copyTitle`),
      icon: markRaw(IconCopy),
    }),
    createControlAction({
      id: "copyId",
      label: t(`collection.context.${type}.copyId`),
      icon: markRaw(IconCopy),
      visible: !isLocal,
    }),
    createControlAction({
      id: "copyUrl",
      label: t(`collection.context.${type}.copyUrl`),
      icon: markRaw(IconCopy),
      visible: isOnline && type !== "cloud",
    }),
  ];
});

const playAllAction = computed(() =>
  collectionActions.value.find((action) => action.id === "playAll"),
);
const addToQueueAction = computed(() =>
  collectionActions.value.find((action) => action.id === "addToQueue"),
);
const subscribeAction = computed(() =>
  collectionActions.value.find((action) => action.id === "toggleSubscribe"),
);
const batchManageAction = computed(() =>
  collectionActions.value.find((action) => action.id === "batchManage"),
);
const openFolderAction = computed(() =>
  collectionActions.value.find((action) => action.id === "openContainingFolder"),
);
const moreMenuItems = computed(() =>
  controlActionsToMenuItems(
    collectionActions.value.filter(
      (action) =>
        ![
          "playAll",
          "addToQueue",
          "toggleSubscribe",
          "batchManage",
          "downloadAlbum",
          "openContainingFolder",
        ].includes(action.id),
    ),
  ),
);

const handleCollectionAction = (key: string): void => {
  switch (key) {
    case "playAll":
      handlePlayAll();
      break;
    case "addToQueue":
      handleAddToQueue();
      break;
    case "toggleSubscribe":
      void subscribe.toggle();
      break;
    case "downloadAlbum":
      break;
    case "batchManage":
      songListRef.value?.enterBatch();
      break;
    case "openContainingFolder":
      void handleOpenAlbumFolder();
      break;
    case "edit":
      manage.openEdit();
      break;
    case "delete":
      manage.openDelete();
      break;
    case "copyTitle":
      copy(collection.value?.title);
      break;
    case "copyId":
      copy(collection.value?.id);
      break;
    case "copyUrl":
      copy(getCollectionShareUrl(collection.value));
      break;
    default:
      if (key.startsWith("download-album:")) handleDownloadAlbum(key);
      break;
  }
};

onMounted(() => {
  loadCollection();
});

onBeforeUnmount(() => {
  loadAbort?.abort();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部信息 -->
    <div v-if="collection" class="shrink-0 px-5 pb-2">
      <div
        class="flex flex-col sm:flex-row mt-2 transition-[gap,margin] duration-300"
        :class="collapsed ? 'gap-3' : 'gap-6'"
      >
        <!-- 封面 -->
        <SImg
          :src="collection.cover"
          :alt="collection.title"
          class="rounded-xl shrink-0 transition-[width,height] duration-300"
          :class="collapsed ? 'size-16 sm:size-20' : 'size-36 sm:size-60'"
        />
        <!-- 信息 -->
        <div class="flex-1 flex flex-col min-w-0 py-1">
          <div
            class="flex flex-col transition-[gap] duration-300"
            :class="collapsed ? 'gap-0.5' : 'gap-2.5'"
          >
            <h1
              class="min-w-0 font-bold text-on-surface truncate lh-normal transition-[font-size,line-height] duration-300"
              :class="collapsed ? 'text-xl' : 'text-3xl lg:text-4xl'"
            >
              {{ collection.title }}
            </h1>
            <div
              class="grid transition-[grid-template-rows,opacity] duration-300"
              :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
            >
              <div class="overflow-hidden flex flex-col gap-2.5">
                <!-- 专辑艺术家优先作为可导航关系展示；其余合集保留创建者文本。 -->
                <div
                  v-if="type === 'album' && collection.artists?.length"
                  class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-base sm:text-lg text-on-surface-variant/80"
                >
                  <template
                    v-for="(artist, index) in collection.artists"
                    :key="`${artist.id ?? ''}:${artist.name}`"
                  >
                    <button
                      type="button"
                      class="min-w-0 truncate transition-colors"
                      :class="
                        canOpenArtist(artist)
                          ? 'cursor-pointer hover:text-primary focus-visible:text-primary'
                          : 'cursor-default'
                      "
                      :disabled="!canOpenArtist(artist)"
                      @click="openArtist(artist)"
                    >
                      {{ artist.name }}
                    </button>
                    <span
                      v-if="index < collection.artists.length - 1"
                      class="text-on-surface-variant/35"
                    >
                      /
                    </span>
                  </template>
                </div>
                <p
                  v-else-if="creatorText"
                  class="truncate text-base sm:text-lg text-on-surface-variant/80"
                >
                  {{ creatorText }}
                </p>

                <!-- 专辑事实：只展示现有 Track 可以可靠派生的信息。 -->
                <div
                  v-if="primaryFacts.length"
                  class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant/55"
                >
                  <template v-for="(fact, index) in primaryFacts" :key="`${fact}:${index}`">
                    <span class="shrink-0">{{ fact }}</span>
                    <span v-if="index < primaryFacts.length - 1" class="text-on-surface-variant/25">
                      ·
                    </span>
                  </template>
                </div>
                <div
                  v-if="secondaryFacts.length"
                  class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant/55"
                >
                  <template v-for="(fact, index) in secondaryFacts" :key="`${fact}:${index}`">
                    <span class="truncate">{{ fact }}</span>
                    <span
                      v-if="index < secondaryFacts.length - 1"
                      class="text-on-surface-variant/25"
                    >
                      ·
                    </span>
                  </template>
                </div>

                <!-- 有简介才占空间；点击可查看全文。 -->
                <SButton
                  v-if="descriptionText"
                  variant="text"
                  size="auto"
                  block
                  static
                  class="group max-w-3xl overflow-hidden text-left text-sm"
                  :aria-label="t('collection.viewIntroduction')"
                  @click="descriptionOpen = true"
                >
                  <span
                    class="line-clamp-3 min-w-0 whitespace-normal leading-5 text-on-surface-variant/65 transition-colors duration-200 group-hover:text-on-surface-variant group-focus-visible:text-on-surface-variant"
                  >
                    {{ descriptionText }}
                  </span>
                </SButton>
              </div>
            </div>
          </div>
          <!--
            碟片筛选与主操作共用一个底部操作区。
            mt-auto 只作用于外层，内部用 gap 保证简介变高时两行也始终有固定间距。
          -->
          <div class="mt-4 sm:mt-auto flex flex-col items-start gap-3">
            <div
              v-if="discOptions.length > 1 && !collapsed"
              class="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-solid border-on-surface/15 bg-on-surface/3 p-0.5"
            >
              <button
                type="button"
                class="h-8 shrink-0 rounded-full px-3 text-sm transition-colors"
                :class="
                  selectedDisc === 'all'
                    ? 'bg-primary/12 text-on-surface font-medium'
                    : 'text-on-surface-variant hover:bg-on-surface/6'
                "
                @click="selectedDisc = 'all'"
              >
                {{ t("collection.allDiscs") }} · {{ collection?.tracks.length ?? 0 }}
              </button>
              <button
                v-for="option in discOptions"
                :key="option.disc"
                type="button"
                class="h-8 shrink-0 rounded-full px-3 text-sm transition-colors"
                :class="
                  selectedDisc === String(option.disc)
                    ? 'bg-primary/12 text-on-surface font-medium'
                    : 'text-on-surface-variant hover:bg-on-surface/6'
                "
                @click="selectedDisc = String(option.disc)"
              >
                {{ t("songList.disc", { number: option.disc }) }} · {{ option.count }}
              </button>
            </div>
            <!-- 操作栏 -->
            <div class="flex flex-wrap items-center gap-2 sm:gap-3">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="!playAllAction?.enabled"
                @click="handleCollectionAction('playAll')"
              >
                <template #icon>
                  <IconLucidePlay />
                </template>
                {{ t("common.playAll") }}
              </SButton>
              <SButton
                variant="secondary"
                round
                :disabled="!addToQueueAction?.enabled"
                @click="handleCollectionAction('addToQueue')"
              >
                <template #icon>
                  <IconLucideListEnd />
                </template>
                {{ t("collection.addToQueue") }}
              </SButton>
              <SButton
                variant="secondary"
                round
                :disabled="!batchManageAction?.enabled"
                @click="handleCollectionAction('batchManage')"
              >
                <template #icon>
                  <IconLucideListChecks />
                </template>
                {{ t("songList.batch.manage") }}
              </SButton>
              <SDropdownMenu
                v-if="downloadAlbumAction.visible"
                :items="controlActionsToMenuItems(downloadAlbumAction.children ?? [])"
                align="start"
                @select="handleCollectionAction"
              >
                <template #trigger>
                  <SButton variant="secondary" round :disabled="!downloadAlbumAction.enabled">
                    <template #icon><IconLucideDownload /></template>
                    {{ t("collection.downloadAlbum") }}
                  </SButton>
                </template>
              </SDropdownMenu>
              <SButton
                v-if="subscribeAction?.visible"
                variant="secondary"
                round
                :disabled="!subscribeAction?.enabled"
                @click="handleCollectionAction('toggleSubscribe')"
              >
                <template #icon>
                  <IconMaterialSymbolsFavoriteRounded v-if="subscribe.isSubscribed.value" />
                  <IconMaterialSymbolsFavoriteOutlineRounded v-else />
                </template>
                {{
                  t(
                    subscribe.isSubscribed.value
                      ? "collection.unsubscribe"
                      : "collection.subscribe",
                  )
                }}
              </SButton>
              <SButton
                v-if="openFolderAction?.visible"
                variant="secondary"
                round
                :disabled="!openFolderAction?.enabled"
                :loading="folderOpening"
                @click="handleCollectionAction('openContainingFolder')"
              >
                <template #icon>
                  <IconLucideFolderOpen />
                </template>
                {{ t("folder.openContaining") }}
              </SButton>
              <SDropdownMenu
                v-if="moreMenuItems.length > 0"
                :items="moreMenuItems"
                align="start"
                @select="handleCollectionAction"
              >
                <template #trigger>
                  <SButton variant="secondary" circle>
                    <template #icon>
                      <IconLucideEllipsis />
                    </template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
    <Transition name="fade" mode="out-in" :duration="150">
      <div
        v-if="collection && collection.tracks.length > 0"
        :key="collection.id"
        class="flex-1 min-h-0"
      >
        <SongList
          ref="songListRef"
          :items="visibleTracks"
          :search-query="searchQuery"
          :show-album="type !== 'album'"
          :show-size="source === 'local'"
          :source="source"
          :collection-type="type"
          :collection-id="id"
          :playback-context="playbackContext"
          :can-remove="manage.canManage.value"
          :group-by-disc="type === 'album' && selectedDisc === 'all'"
          enable-sort
          @scroll="handleListScroll"
          @change="handleTracksRemoved"
        >
          <template #headerActions>
            <SInput
              v-model="searchQuery"
              :placeholder="t('collection.filterTracks')"
              clearable
              round
              class="w-36 sm:w-44 lg:w-52"
              data-search-input
            >
              <template #prefix>
                <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
              </template>
            </SInput>
          </template>
        </SongList>
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 错误态 -->
      <div v-else-if="error" key="error" class="flex-1 flex items-center justify-center px-6">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-4 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs mb-4">{{ error }}</div>
          <SButton type="primary" variant="secondary" @click="loadCollection">
            <template #icon><IconLucideRefreshCw /></template>
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="collection" key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("collection.empty") }}</div>
        </div>
      </div>
    </Transition>
    <!-- 简介全文 -->
    <SDialog
      v-model:open="descriptionOpen"
      :title="t('collection.introduction', { type: typeLabel })"
      width="min(520px, calc(100vw - 40px))"
    >
      <p class="whitespace-pre-wrap break-words leading-6 text-on-surface-variant">
        {{ descriptionText }}
      </p>
    </SDialog>
    <!-- 一个专辑来自多个目录时才出现，让用户明确选择目标目录。 -->
    <SDialog
      v-model:open="folderChoiceOpen"
      :title="t('collection.chooseFolder')"
      width="min(560px, calc(100vw - 40px))"
    >
      <div class="flex flex-col gap-2">
        <button
          v-for="path in folderChoices"
          :key="path"
          type="button"
          class="flex min-w-0 items-center gap-3 rounded-xl border border-solid border-outline-variant/25 px-3 py-2.5 text-left transition-colors hover:bg-on-surface/6"
          @click="openFolderPath(path)"
        >
          <IconLucideFolderOpen class="size-5 shrink-0 text-primary/70" />
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-on-surface">
              {{ folderName(path) }}
            </span>
            <span class="block truncate text-xs text-on-surface-variant/55">
              {{ path }}
            </span>
          </span>
        </button>
      </div>
    </SDialog>
    <!-- 编辑弹窗 -->
    <SDialog v-model:open="manage.editOpen.value" :title="editLabel" width="400px">
      <div class="flex flex-col gap-4">
        <SFormItem :label="t('collection.name', { type: typeLabel })">
          <SInput v-model="manage.editTitle.value" :disabled="manage.submitting.value" />
        </SFormItem>
        <SFormItem :label="t('collection.description', { type: typeLabel })">
          <SInput v-model="manage.editDescription.value" :disabled="manage.submitting.value" />
        </SFormItem>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.submitting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          type="primary"
          :disabled="!manage.editTitle.value.trim()"
          :loading="manage.submitting.value"
          @click="manage.saveEdit"
        >
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
    <!-- 删除确认 -->
    <SDialog
      v-model:open="manage.deleteOpen.value"
      :title="t('collection.delete', { type: typeLabel })"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("collection.deleteConfirm", { type: typeLabel, title: collection?.title ?? "" }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.deleting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" :loading="manage.deleting.value" @click="manage.confirmDelete">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
