import localforage from "localforage";
import type { Track, Artist, IpcResponse } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary, ScanProgress } from "@shared/types/library";
import type { Collection } from "@/types/collection";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { libraryClient } from "@/core/libraryClient";
import { subscribeCoreControlEvent } from "@/core/controlEventClient";

const trackDb = localforage.createInstance({ name: "splayer", storeName: "library" });

/** 本地喜欢 id 在 trackDb 内的持久化 key */
const LIKED_IDS_KEY = "liked-ids";

export type LibraryLoadState = "idle" | "loading" | "success" | "error";

export const useLibraryStore = defineStore("library", () => {
  /** 曲目列表 */
  const tracks = shallowRef<Track[]>([]);
  /** 曲目请求结果独立于缓存和其它初始化任务，避免把尚未取得数据当作空库。 */
  const tracksLoadState = ref<LibraryLoadState>("idle");
  const tracksLoadError = ref<string | null>(null);
  /** 扫描目录列表 */
  const scanDirs = ref<string[]>([]);
  const scanDirsLoadState = ref<LibraryLoadState>("idle");
  let scanDirsRequest: Promise<void> | null = null;
  let scanDirsEventVersion = 0;
  /** 是否正在扫描 */
  const scanning = ref(false);
  /** 扫描进度 */
  const scanProgress = ref<ScanProgress | null>(null);
  let scanProgressVersion = 0;
  /** 是否已初始化 */
  const initialized = ref(false);
  const revision = ref(0);
  let tracksStale = true;
  let trackConsumers = 0;
  let tracksRequest: Promise<void> | null = null;
  /** 歌手头像缓存 */
  const artistAvatars = shallowRef<Record<string, string>>({});
  /** 本地红心 id */
  const likedOrderedIds = shallowRef<string[]>([]);
  /** 本地红心 id 集合 */
  const likedIdSet = shallowRef<Set<string>>(new Set());
  let likesLoaded = false;
  let likesRequest: Promise<void> | null = null;

  /** 应用 Core 权威本地红心快照。 */
  const applyLikedIds = (ids: string[]): void => {
    likedOrderedIds.value = [...ids];
    likedIdSet.value = new Set(ids);
  };

  /** 是否已收藏 */
  const isLiked = (trackId: string): boolean => {
    if (!likesLoaded && !likesRequest) void loadLikes();
    return likedIdSet.value.has(trackId);
  };

  /**
   * 切换收藏
   * @param trackId 歌曲 id
   */
  const toggleLike = async (trackId: string): Promise<boolean> => {
    if (!trackId) return false;
    await loadLikes();
    const liked = !likedIdSet.value.has(trackId);
    const result = await libraryClient.setTrackLiked(trackId, liked);
    if (!result.success || !result.data) {
      throw new Error(result.error ?? "LIBRARY_LIKE_FAILED");
    }
    applyLikedIds(result.data);
    return liked;
  };

  /** 标准化歌手名 */
  const normalizeArtistName = (name: string): string => name.trim().toLowerCase();

  /**
   * 获取歌手头像
   * @param artistName 歌手名
   */
  const getArtistAvatar = (artistName: string): string | undefined => {
    const key = normalizeArtistName(artistName);
    if (!key) return;
    return artistAvatars.value[key];
  };

  /**
   * 设置歌手头像
   * @param artistName 歌手名
   * @param avatar 歌手头像
   */
  const setArtistAvatar = (artistName: string, avatar: string): void => {
    const key = normalizeArtistName(artistName);
    if (!key || !avatar) return;
    if (artistAvatars.value[key] === avatar) return;
    artistAvatars.value = { ...artistAvatars.value, [key]: avatar };
  };

  /** 批量预取头像 */
  const loadArtistAvatars = async (artistNames: string[]): Promise<void> => {
    const names = artistNames.filter((name) => !artistAvatars.value[normalizeArtistName(name)]);
    if (!names.length) return;
    const res = await libraryClient.prefetchArtistAvatars(names).catch(() => null);
    if (!res?.success || !res.data) return;
    const patch: Record<string, string> = {};
    for (const [key, avatar] of Object.entries(res.data)) {
      if (avatar) patch[key] = avatar;
    }
    if (Object.keys(patch).length > 0) {
      artistAvatars.value = { ...artistAvatars.value, ...patch };
    }
  };

  /** 将曲目写入 IndexedDB 缓存 */
  const cacheTracks = (items: Track[]): void => {
    trackDb.setItem("tracks", toRaw(items)).catch(() => {});
  };

  const loadLikes = async (): Promise<void> => {
    if (likesLoaded) return;
    if (likesRequest) return likesRequest;
    likesRequest = (async () => {
      const legacyLiked = await trackDb.getItem<string[]>(LIKED_IDS_KEY).catch(() => null);
      const previousIds = likedOrderedIds.value;
      const result =
        Array.isArray(legacyLiked) && legacyLiked.length > 0
          ? await libraryClient.importLikedTrackIds(legacyLiked)
          : await libraryClient.getLikedTrackIds();
      if (!result.success || !result.data) return;
      if (previousIds === likedOrderedIds.value) applyLikedIds(result.data);
      likesLoaded = true;
      if (Array.isArray(legacyLiked)) void trackDb.removeItem(LIKED_IDS_KEY).catch(() => {});
    })().finally(() => {
      likesRequest = null;
    });
    return likesRequest;
  };

  const loadScanDirs = (): Promise<void> => {
    if (scanDirsRequest) return scanDirsRequest;
    scanDirsLoadState.value = "loading";
    const version = scanDirsEventVersion;
    scanDirsRequest = libraryClient
      .getScanDirs()
      .then((result) => {
        if (version !== scanDirsEventVersion) return;
        if (result.success && result.data) {
          scanDirs.value = result.data;
          scanDirsLoadState.value = "success";
        } else {
          scanDirsLoadState.value = "error";
        }
      })
      .finally(() => {
        scanDirsRequest = null;
      });
    return scanDirsRequest;
  };

  const syncScanProgress = async (): Promise<void> => {
    const version = scanProgressVersion;
    const result = await libraryClient.getScanProgress();
    if (version !== scanProgressVersion || !result.success || !result.data) return;
    scanning.value = result.data.phase === "scanning";
    scanProgress.value = scanning.value ? result.data : null;
  };

  /** 开始扫描 */
  const startScan = async (incremental = true): Promise<void> => {
    if (scanning.value) return;
    const version = ++scanProgressVersion;
    scanning.value = true;
    scanProgress.value = { phase: "scanning", stage: "discovering", total: 0, scanned: 0 };
    const res = await libraryClient.scan(incremental);
    if (!res.success && version === scanProgressVersion) {
      scanning.value = false;
      scanProgress.value = null;
      void syncScanProgress();
    }
  };

  /** 取消扫描 */
  const cancelScan = async (): Promise<void> => {
    const result = await libraryClient.cancelScan();
    if (result.success && scanning.value) {
      scanProgressVersion++;
      await syncScanProgress();
    }
  };

  /** 添加一个已经由 Core 目录浏览器选定的扫描目录。 */
  const addScanDir = async (
    requestedDir: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const dir = requestedDir.trim();
    if (!dir) return { success: false, error: "empty" };
    const res = await libraryClient.addScanDir(dir);
    if (!res.success || !res.data) return res;

    const newDir = res.data as string;
    if (!scanDirs.value.includes(newDir)) {
      scanDirs.value = [...scanDirs.value, newDir];
    }
    return res;
  };

  /** 移除扫描目录 */
  const removeScanDir = async (dir: string): Promise<void> => {
    const result = await libraryClient.removeScanDir(dir);
    if (!result.success) return;
    scanDirs.value = scanDirs.value.filter((d) => d !== dir);
    // 移除目录取消正在进行的扫描
    if (scanning.value) {
      scanProgressVersion++;
      scanning.value = false;
      scanProgress.value = null;
    }
    tracksStale = true;
    if (trackConsumers > 0) await refreshTracksProjection();
  };

  let unsubscribe: (() => void) | null = null;
  let unsubscribeLibraryChanged: (() => void) | null = null;
  let unsubscribeLibraryRootsChanged: (() => void) | null = null;
  let unsubscribeLibraryLikesChanged: (() => void) | null = null;

  const refreshTracksProjection = (): Promise<void> => {
    if (tracksRequest) return tracksRequest;
    tracksRequest = (async () => {
      tracksLoadState.value = "loading";
      tracksLoadError.value = null;
      if (!initialized.value) {
        const cached = await trackDb.getItem<Track[]>("tracks").catch(() => null);
        if (cached?.length) tracks.value = cached;
      }
      const requestedRevision = revision.value;
      const res = await libraryClient.getTracks();
      if (!res.success || !res.data) {
        tracksLoadState.value = "error";
        tracksLoadError.value = res.error ?? "LIBRARY_LOAD_FAILED";
        return;
      }
      tracks.value = res.data;
      tracksStale = revision.value !== requestedRevision;
      cacheTracks(res.data);
      tracksLoadState.value = "success";
    })().finally(() => {
      initialized.value = true;
      tracksRequest = null;
      if (
        tracksStale &&
        trackConsumers > 0 &&
        !scanning.value &&
        tracksLoadState.value === "success"
      ) {
        void refreshTracksProjection();
      }
    });
    return tracksRequest;
  };

  const watchTracks = (): (() => void) => {
    trackConsumers++;
    void loadLikes();
    if (!initialized.value || tracksStale || tracksLoadState.value === "error") {
      void refreshTracksProjection();
    }
    return () => {
      trackConsumers--;
    };
  };

  /** 监听扫描进度 */
  const subscribeScanProgress = (): void => {
    if (unsubscribe) return;
    unsubscribe = subscribeCoreControlEvent("libraryScanProgress", (data) => {
      scanProgressVersion++;
      scanProgress.value = data;
      if (data.phase === "scanning") {
        scanning.value = true;
      } else if (data.phase === "done") {
        scanning.value = false;
        scanProgress.value = null;
        if (trackConsumers > 0 && tracksStale) void refreshTracksProjection();
      } else if (data.phase === "error") {
        scanning.value = false;
        scanProgress.value = null;
      }
    });
    unsubscribeLibraryChanged = subscribeCoreControlEvent("libraryChanged", (data) => {
      revision.value = data.revision;
      tracksStale = true;
      if (!scanning.value && trackConsumers > 0) void refreshTracksProjection();
    });
    unsubscribeLibraryRootsChanged = subscribeCoreControlEvent("libraryRootsChanged", (data) => {
      scanDirsEventVersion++;
      scanDirs.value = [...data.paths];
      scanDirsLoadState.value = "success";
    });
    unsubscribeLibraryLikesChanged = subscribeCoreControlEvent("libraryLikesChanged", ({ ids }) => {
      applyLikedIds(ids);
    });
  };

  const unsubscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeLibraryChanged?.();
    unsubscribeLibraryChanged = null;
    unsubscribeLibraryRootsChanged?.();
    unsubscribeLibraryRootsChanged = null;
    unsubscribeLibraryLikesChanged?.();
    unsubscribeLibraryLikesChanged = null;
  };

  /**
   * 按 id 替换曲目数据并回写缓存（标签编辑后调用）
   * @param updates 更新后的 Track 列表
   */
  const applyTrackUpdates = (updates: Track[]): void => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((item) => [item.id, item]));
    if (!tracks.value.some((item) => byId.has(item.id))) return;
    tracks.value = tracks.value.map((item) => byId.get(item.id) ?? item);
    cacheTracks(tracks.value);
  };

  /** 专辑聚合列表 */
  const getAlbumList = (): Promise<IpcResponse<AlbumSummary[]>> => libraryClient.getAlbums();

  /** 歌手聚合列表 */
  const getArtistList = (): Promise<IpcResponse<ArtistSummary[]>> => libraryClient.getArtists();

  /** 专辑详情 */
  const getAlbumCollection = async (
    albumId: string,
    albumName?: string,
  ): Promise<Collection | null> => {
    const res = await libraryClient.getAlbumTracks(albumId, albumName);
    if (!res.success || !res.data?.length) return null;
    const albumTracks = res.data;
    const resolvedName = albumTracks[0]?.album?.name ?? albumName ?? albumId;
    const artistMap = new Map<string, Artist>();
    for (const t of albumTracks) {
      for (const a of t.artists) {
        const key = a.name.toLowerCase();
        if (!artistMap.has(key)) artistMap.set(key, a);
      }
    }
    return {
      id: albumId,
      type: "album",
      source: "local",
      title: resolvedName,
      cover: albumTracks.find((t) => t.cover)?.cover,
      artists: [...artistMap.values()],
      tracks: albumTracks,
      trackCount: albumTracks.length,
    };
  };

  /** 歌手详情 */
  const getArtistProfile = async (artistName: string): Promise<ArtistProfile | null> => {
    const name = artistName.trim();
    if (!name) return null;
    const res = await libraryClient.getArtistTracks(name);
    if (!res.success || !res.data?.length) return null;
    const artistTracks = res.data;
    const albumMap = new Map<string, { name: string; cover?: string; count: number }>();
    for (const t of artistTracks) {
      if (!t.album?.name) continue;
      const key = t.album.id ?? t.album.name;
      const existing = albumMap.get(key);
      if (existing) {
        existing.count++;
        if (!existing.cover && t.cover) existing.cover = t.cover;
      } else {
        albumMap.set(key, { name: t.album.name, cover: t.cover, count: 1 });
      }
    }
    const albums: CoverItem[] = [...albumMap.entries()].map(([albumId, info]) => ({
      id: albumId,
      title: info.name,
      cover: info.cover,
      trackCount: info.count,
    }));
    return {
      id: encodeURIComponent(name),
      name,
      avatar: getArtistAvatar(name),
      source: "local",
      tracks: artistTracks,
      albums,
      trackCount: artistTracks.length,
      albumCount: albums.length,
    };
  };

  subscribeScanProgress();
  onScopeDispose(unsubscribeScanProgress);

  return {
    tracks,
    tracksLoadState,
    tracksLoadError,
    scanDirs,
    scanDirsLoadState,
    scanning,
    scanProgress,
    initialized,
    revision,
    artistAvatars,
    likedOrderedIds,
    likedIdSet,
    isLiked,
    toggleLike,
    load: refreshTracksProjection,
    loadScanDirs,
    syncScanProgress,
    watchTracks,
    startScan,
    cancelScan,
    addScanDir,
    removeScanDir,
    subscribeScanProgress,
    unsubscribeScanProgress,
    applyTrackUpdates,
    getArtistAvatar,
    setArtistAvatar,
    loadArtistAvatars,
    getArtistList,
    getAlbumList,
    getAlbumCollection,
    getArtistProfile,
  };
});
