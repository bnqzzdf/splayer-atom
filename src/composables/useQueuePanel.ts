import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Track } from "@shared/types/player";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { clearQueue, queue, queueLength } from "@/stores/queue";
import { useTrackMenu } from "@/composables/useTrackMenu";
import * as player from "@/core/player";

export interface UseQueuePanelOptions {
  listRef: Ref<SVirtualListExposed | null>;
}

/**
 * 播放队列面板的共享逻辑
 * 视觉表达交给具体组件，这里只管：播放、移除、清空、定位
 */
export const useQueuePanel = (options: UseQueuePanelOptions) => {
  const { t } = useI18n();
  const statusStore = useStatusStore();
  const mediaStore = useMediaStore();
  const menuTrack = shallowRef<Track | null>(null);
  const { openContainingFolder: openMenuTrackContainingFolder } = useTrackMenu(menuTrack, {
    hidePlayActions: true,
  });

  /** 拼接艺术家名称 */
  const formatArtists = (artists: Track["artists"]): string => {
    if (!artists?.length) return t("playlist.unknownArtist");
    return artists.map((ar) => ar.name).join(" / ");
  };

  /** 播放指定索引；是否关闭面板交给调用方决定 */
  const playAt = async (index: number): Promise<void> => {
    await player.playAtIndex(index);
  };

  /** 移除单首 */
  const removeAt = (index: number): void => {
    player.removeFromQueue(index);
  };

  const openContainingFolder = async (track: Track): Promise<boolean> => {
    menuTrack.value = track;
    return openMenuTrackContainingFolder();
  };

  const clearConfirmOpen = ref(false);

  /** 清空队列 + 重置播放索引 */
  const clearAll = (): void => {
    if (queueLength.value === 0) return;
    player.stop();
    statusStore.playIndex = -1;
    clearQueue();
    mediaStore.clear();
    useThemeStore().coverColor = null;
    clearConfirmOpen.value = false;
  };

  /** 滚动到当前正在播放项 */
  const scrollToCurrent = (): void => {
    if (statusStore.playIndex >= 0) {
      options.listRef.value?.scrollToIndex(statusStore.playIndex);
    }
  };

  /** 当前曲目之后各曲时长之和；与播放进度无关，单独缓存避免每次进度更新都遍历队列 */
  const upcomingDuration = computed(() => {
    const list = queue.value;
    let total = 0;
    for (let i = Math.max(0, statusStore.playIndex + 1); i < list.length; i++) {
      total += list[i].duration;
    }
    return total;
  });

  /** 队列剩余总时长（毫秒）：当前曲剩余部分 + 后续曲目；随机模式下队列已按播放顺序排列 */
  const remainingDuration = computed(() => {
    const current = queue.value[statusStore.playIndex];
    if (!current) return upcomingDuration.value;
    const total = statusStore.duration > 0 ? statusStore.duration : current.duration;
    return upcomingDuration.value + Math.max(0, total - statusStore.position);
  });

  return {
    statusStore,
    queue,
    queueLength,
    remainingDuration,
    formatArtists,
    playAt,
    removeAt,
    openContainingFolder,
    clearConfirmOpen,
    clearAll,
    scrollToCurrent,
  };
};
