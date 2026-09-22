import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

type PackageReleaseMetadata = {
  productName?: string;
  version?: string;
};

export const readCoreReleaseMetadata = (): { productName: string; version: string } => {
  const metadata = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as PackageReleaseMetadata;
  if (metadata.productName !== "SPlayer Atom" || !metadata.version) {
    throw new Error("package.json 缺少 SPlayer Atom 产品名称或版本号");
  }
  return { productName: metadata.productName, version: metadata.version };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const resolveCoreBuildDate = (
  explicit = process.env.ATOM_BUILD_DATE?.trim(),
  now = new Date(),
): string => {
  const value = explicit || `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`ATOM_BUILD_DATE 必须使用 YYYYMMDD 格式，当前为 ${value}`);
  }
  return value;
};

export const formatCoreBuildDate = (value: string): string =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

export const coreArtifactFileName = (
  bundleNode: boolean,
  version: string,
  buildDate: string,
): string =>
  `splayer-atom-core-${version}-${buildDate}-${bundleNode ? "bundled" : "system"}-linux-x64.tar.gz`;
