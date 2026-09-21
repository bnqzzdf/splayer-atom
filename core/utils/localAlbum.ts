import { createHash } from "node:crypto";
import path from "node:path";
import { sacdIsoPathFromVirtual } from "./localPhysicalSource";

const DISC_LABEL =
  /^(?:cd|disc|disk|sacd|dvd)\s*[-_. ]*0*(\d+)(?:\s*(?:of|\/)\s*\d+)?(?:\s*[-_.].*)?$/i;

/** SACD 虚拟分轨使用物理 ISO 路径参与本地专辑归属。 */
const physicalPath = (value: string): string => sacdIsoPathFromVirtual(value) ?? value;

/** 从 CD1 / Disc 2 / SACD03 这类目录或文件名中提取碟号。 */
const discNumberFromLabel = (value: string): number | undefined => {
  const match = DISC_LABEL.exec(value.trim());
  if (!match) return undefined;
  const valueNumber = Number(match[1]);
  return Number.isInteger(valueNumber) && valueNumber > 0 ? valueNumber : undefined;
};

/**
 * 从物理路径推断碟号。显式 metadata 缺失时，支持常见 CD1/Disc 2 子目录，
 * 以及 "Album Disc 2.iso" 这类多碟 SACD 文件名。
 */
export const inferDiscNumberFromPath = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const source = physicalPath(value);
  const parent = path.basename(path.dirname(source));
  const fromParent = discNumberFromLabel(parent);
  if (fromParent) return fromParent;

  const ext = path.extname(source);
  const stem = path.basename(source, ext);
  return discNumberFromLabel(stem);
};

/**
 * 本地专辑的物理归属目录。多碟子目录向上收敛一级，使 CD1/CD2 仍属于同一张专辑。
 */
export const localAlbumRoot = (value: string): string => {
  const source = physicalPath(value);
  let directory = path.dirname(source);
  if (discNumberFromLabel(path.basename(directory))) directory = path.dirname(directory);
  return path.resolve(directory);
};

/**
 * 生成不依赖专辑标题唯一性的本地专辑 ID。
 * 同名专辑只要位于不同物理专辑目录就会得到不同 ID；多碟目录仍共享同一 ID。
 */
export const createLocalAlbumId = (albumName: string, sourcePath: string): string =>
  createHash("sha256")
    .update(albumName.trim())
    .update("\0")
    .update(localAlbumRoot(sourcePath))
    .digest("hex")
    .slice(0, 20);
