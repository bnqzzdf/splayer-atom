import localforage from "localforage";
import type { Track, Artist } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary, ScanProgress } from "@shared/types/library";
import type { Collection } from "@/types/collection";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { libraryClient } from "@/core/libraryClient";
import { subscribeCoreControlEvent } from "@/core/controlEventClient";

const trackDb = localforage.createInstance({ name: "splayer", storeName: "library" });

/** 本地喜欢 id 在 trackDb 内的持久化 key */
const LIKED_IDS_KEY = "liked-ids";

export const useLibraryStore = defineStore("library", () => {
  /** 曲目列表 */
  const tracks = shallowRef<Track[]>([]);
  /** 扫描目录列表 */
  const scanDirs = ref<string[]>([]);
  /** 是否正在扫描 */
  const scanning = ref(false);
  /** 扫描进度 */
  const scanProgress = ref<ScanProgress | null>(null);
  /** 是否已初始化 */
  const initialized = ref(false);
  /** 歌手头像缓存 */
  const artistAvatars = shallowRef<Record<string, string>>({});
  /** 本地红心 id */
  const likedOrderedIds = shallowRef<string[]>([]);
  /** 本地红心 id 集合 */
  const likedIdSet = shallowRef<Set<string>>(new Set());

  /** 持久化喜欢列表 */
  const persistLiked = (): void => {
    trackDb.setItem(LIKED_IDS_KEY, [...likedOrderedIds.value]).catch(() => {});
  };

  /** 是否已收藏 */
  const isLiked = (trackId: string): boolean => likedIdSet.value.has(trackId);

  /**
   * 切换收藏
   * @param trackId 歌曲 id
   */
  const toggleLike = (trackId: string): boolean => {
    if (!trackId) return false;
    const next = new Set(likedIdSet.value);
    if (next.has(trackId)) {
      next.delete(trackId);
      likedOrderedIds.value = likedOrderedIds.value.filter((id) => id !== trackId);
    } else {
      next.add(trackId);
      likedOrderedIds.value = [trackId, ...likedOrderedIds.value];
    }
    likedIdSet.value = next;
    persistLiked();
    return next.has(trackId);
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
  const loadArtistAvatars = async (): Promise<void> => {
    const list = await getArtistList();
    const names = list
      .filter((item) => !artistAvatars.value[normalizeArtistName(item.name)])
      .map((item) => item.name);
    if (!names.length) return;
    const res = await libraryClient.prefetchArtistAvatars(names);
    if (!res.success || !res.data) return;
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

  /** 加载曲目和目录列表 */
  const load = async (): Promise<void> => {
    // 扫描进度是曲库域投影，由 store 常驻订阅，避免关闭设置页后丢失完成事件。
    subscribeScanProgress();
    // 先从 IndexedDB 读缓存，立即渲染
    const [cached, likedCached] = await Promise.all([
      trackDb.getItem<Track[]>("tracks").catch(() => null),
      trackDb.getItem<string[]>(LIKED_IDS_KEY).catch(() => null),
    ]);
    if (cached?.length) tracks.value = cached;
    if (Array.isArray(likedCached)) {
      likedOrderedIds.value = likedCached;
      likedIdSet.value = new Set(likedCached);
    }
    // 拿最新数据并回写缓存
    const [tracksRes, dirsRes] = await Promise.all([
      libraryClient.getTracks(),
      libraryClient.getScanDirs(),
    ]);
    if (tracksRes.success && tracksRes.data) {
      tracks.value = tracksRes.data;
      cacheTracks(tracksRes.data);
    }
    if (dirsRes.success && dirsRes.data) scanDirs.value = dirsRes.data;
    initialized.value = true;
    // 同步服务端真实扫描状态，防止残留
    try {
      const scanStatus = await libraryClient.isScanning();
      if (scanStatus.success && scanStatus.data) {
        const isCurrentlyScanning = Boolean(
          (scanStatus.data as any).is_scanning ?? scanStatus.data,
        );
        scanning.value = isCurrentlyScanning;
        if (!isCurrentlyScanning) scanProgress.value = null;
      } else {
        scanning.value = false;
        scanProgress.value = null;
      }
    } catch {
      scanning.value = false;
      scanProgress.value = null;
    }
    // 预取歌手头像
    loadArtistAvatars();
  };

  /** 开始扫描 */
  const startScan = async (incremental = true): Promise<void> => {
    if (scanning.value) return;
    scanning.value = true;
    scanProgress.value = { phase: "scanning", total: 0, scanned: 0 };
    try {
      const res = await libraryClient.scan(incremental);
      if (!res.success) {
        scanning.value = false;
        scanProgress.value = null;
      }
    } catch {
      scanning.value = false;
      scanProgress.value = null;
    }
  };

  /** 取消扫描 */
  const cancelScan = async (): Promise<void> => {
    await libraryClient.cancelScan();
    scanning.value = false;
    scanProgress.value = null;
  };

  /** 判断两个 Core 扫描根目录是否互相包含。 */
  const conflictsWithScanDir = (dir: string): boolean =>
    scanDirs.value.some(
      (existing) =>
        dir.startsWith(existing + "\\") ||
        dir.startsWith(existing + "/") ||
        existing.startsWith(dir + "\\") ||
        existing.startsWith(dir + "/"),
    );

  /** 添加一个已经由 Core 目录浏览器选定的扫描目录。 */
  const addScanDir = async (
    requestedDir: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const dir = requestedDir.trim();
    if (!dir) return { success: false, error: "empty" };
    if (conflictsWithScanDir(dir)) {
      return { success: false, error: "nested" };
    }
    const res = await libraryClient.addScanDir(dir);
    if (!res.success || !res.data) return res;

    const newDir = res.data as string;
    if (conflictsWithScanDir(newDir)) {
      await libraryClient.removeScanDir(newDir);
      return { success: false, error: "nested" };
    }
    if (!scanDirs.value.includes(newDir)) {
      scanDirs.value = [...scanDirs.value, newDir];
    }
    return res;
  };

  /** 移除扫描目录 */
  const removeScanDir = async (dir: string): Promise<void> => {
    await libraryClient.removeScanDir(dir);
    scanDirs.value = scanDirs.value.filter((d) => d !== dir);
    // 移除目录取消正在进行的扫描
    if (scanning.value) {
      scanning.value = false;
      scanProgress.value = null;
    }
    const res = await libraryClient.getTracks();
    if (res.success && res.data) {
      tracks.value = res.data;
      cacheTracks(res.data);
      loadArtistAvatars();
    }
  };

  let unsubscribe: (() => void) | null = null;
  let unsubscribeLibraryChanged: (() => void) | null = null;
  let unsubscribeLibraryRootsChanged: (() => void) | null = null;

  const refreshTracksProjection = (): void => {
    libraryClient.getTracks().then((res) => {
      if (!res.success || !res.data) return;
      tracks.value = res.data;
      cacheTracks(res.data);
      loadArtistAvatars();
    });
  };

  /** 监听扫描进度 */
  const subscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribeLibraryChanged?.();
    unsubscribeLibraryRootsChanged?.();
    unsubscribe = subscribeCoreControlEvent("libraryScanProgress", (data) => {
      scanProgress.value = data;
      if (data.phase === "scanning") {
        scanning.value = true;
      } else if (data.phase === "done") {
        scanning.value = false;
        scanProgress.value = null;
        refreshTracksProjection();
      } else if (data.phase === "error") {
        scanning.value = false;
        scanProgress.value = null;
      }
    });
    unsubscribeLibraryChanged = subscribeCoreControlEvent("libraryChanged", () => {
      // 扫描过程由 done 时统一拉取全量曲库，避免每个 20-track batch 重取大 JSON。
      // 定向 canonicalization / 标签写入等非扫描 mutation 则立即刷新全局曲库投影。
      if (!scanning.value) refreshTracksProjection();
    });
    unsubscribeLibraryRootsChanged = subscribeCoreControlEvent("libraryRootsChanged", (data) => {
      scanDirs.value = [...data.paths];
    });
  };

  const unsubscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeLibraryChanged?.();
    unsubscribeLibraryChanged = null;
    unsubscribeLibraryRootsChanged?.();
    unsubscribeLibraryRootsChanged = null;
  };

  /** 删除曲目文件并刷新列表 */
  const deleteTracks = async (paths: string[]): Promise<{ deleted: number; failed: number }> => {
    const res = await libraryClient.deleteTracks(paths);
    if (res.success) {
      // 找出被删歌曲的 id，用于裁喜欢
      const pathSet = new Set(paths);
      const deletedIds = new Set(
        tracks.value.filter((t) => t.path && pathSet.has(t.path)).map((t) => t.id),
      );
      // 从本地列表中移除已删除的曲目
      const remaining = tracks.value.filter((t) => !t.path || !pathSet.has(t.path));
      tracks.value = remaining;
      cacheTracks(remaining);
      // 同步剪掉失效的喜欢 id
      if (deletedIds.size > 0 && likedOrderedIds.value.some((id) => deletedIds.has(id))) {
        const filtered = likedOrderedIds.value.filter((id) => !deletedIds.has(id));
        likedOrderedIds.value = filtered;
        likedIdSet.value = new Set(filtered);
        persistLiked();
      }
      return res.data ?? { deleted: 0, failed: paths.length };
    }
    return { deleted: 0, failed: paths.length };
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
  const getAlbumList = async (): Promise<AlbumSummary[]> => {
    const res = await libraryClient.getAlbums();
    return res.success && res.data ? res.data : [];
  };

  /** 歌手聚合列表 */
  const getArtistList = async (): Promise<ArtistSummary[]> => {
    const res = await libraryClient.getArtists();
    return res.success && res.data ? res.data : [];
  };

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

  return {
    tracks,
    scanDirs,
    scanning,
    scanProgress,
    initialized,
    artistAvatars,
    likedOrderedIds,
    likedIdSet,
    isLiked,
    toggleLike,
    load,
    startScan,
    cancelScan,
    addScanDir,
    removeScanDir,
    subscribeScanProgress,
    unsubscribeScanProgress,
    deleteTracks,
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
