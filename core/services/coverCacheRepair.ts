import path from "node:path";
import fs from "node:fs/promises";
import { getCoverSourcePath } from "@main/database";
import { toCacheUrl } from "@main/atom/cacheUrl";
import { getCoverCacheDir } from "@main/utils/config";
import { sacdIsoPathFromVirtual } from "@main/utils/localPhysicalSource";
import { libraryLog } from "@main/utils/logger";
import { getEngine } from "./engine";

const GENERATED_COVER_FILE = /^(?:cover|directory_cover)_[0-9a-f]{16}_thumb\.jpg$/i;
const repairs = new Map<string, Promise<boolean>>();
const MAX_CONCURRENT_REPAIRS = 4;
const REPAIR_WAIT_MS = 2_000;
let activeRepairs = 0;

const repair = async (filename: string): Promise<boolean> => {
  if (!GENERATED_COVER_FILE.test(filename) || path.basename(filename) !== filename) return false;
  const cover = `cache://covers/${filename}`;
  const source = getCoverSourcePath(cover);
  if (!source) return false;
  const physicalSource = sacdIsoPathFromVirtual(source) ?? source;
  try {
    const scanned = await getEngine().probeScannedTrack(physicalSource, getCoverCacheDir());
    const regenerated = toCacheUrl(scanned.cover);
    if (!regenerated || !scanned.cover) return false;
    if (regenerated !== cover) {
      await fs.mkdir(getCoverCacheDir(), { recursive: true });
      await fs.copyFile(scanned.cover, path.join(getCoverCacheDir(), filename));
    }
    return true;
  } catch (error) {
    libraryLog.warn(`重建封面缓存失败 [${physicalSource}]: ${String(error)}`);
    return false;
  }
};

/** 缓存文件被清理或升级环境变化后，只重建浏览器实际请求到的封面。 */
export const repairMissingCoverCache = (filename: string): Promise<boolean> => {
  let pending = repairs.get(filename);
  if (!pending) {
    if (activeRepairs >= MAX_CONCURRENT_REPAIRS) return Promise.resolve(false);
    activeRepairs++;
    pending = repair(filename).finally(() => {
      repairs.delete(filename);
      activeRepairs--;
    });
    repairs.set(filename, pending);
  }
  return Promise.race([
    pending,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), REPAIR_WAIT_MS)),
  ]);
};
