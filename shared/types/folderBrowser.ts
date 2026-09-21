import type { Track } from "./player";

export type FolderMaterialType = "image" | "pdf" | "text";

export interface FolderRootEntry {
  name: string;
  path: string;
  available: boolean;
  pinned: boolean;
}

export interface FolderPinEntry {
  name: string;
  path: string;
  root: string | null;
  available: boolean;
}

export interface FolderDirectoryEntry {
  kind: "directory";
  name: string;
  path: string;
}

export interface FolderTrackEntry {
  kind: "track";
  name: string;
  path: string;
  track: Track;
}

export interface FolderFileEntry {
  kind: "file";
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface FolderContainerEntry {
  kind: "cue" | "sacd";
  name: string;
  path: string;
  trackCount?: number;
}

export interface FolderMaterialEntry {
  kind: "material";
  materialType: FolderMaterialType;
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export type FolderBrowseEntry =
  | FolderDirectoryEntry
  | FolderTrackEntry
  | FolderFileEntry
  | FolderContainerEntry
  | FolderMaterialEntry;

export interface FolderBrowsePage {
  path: string;
  root: string;
  parent: string | null;
  unavailable: boolean;
  counts: {
    directories: number;
    media: number;
    materials: number;
    total: number;
  };
  entries: FolderBrowseEntry[];
  previousCursor?: string;
  nextCursor?: string;
}

export interface FolderContainerResult {
  kind: "cue" | "sacd";
  path: string;
  tracks: Track[];
  canonical: boolean;
}

export interface FolderSearchResult {
  kind: "directory" | "file";
  name: string;
  path: string;
  parent: string;
  root: string;
}

export interface FolderSearchPage {
  data: FolderSearchResult[];
  nextCursor?: string;
  truncated?: boolean;
}

export interface FolderNavigationTarget {
  path: string;
  containerPath?: string;
  focusTrackId?: string;
  focusPath?: string;
}

export type FolderActionMode = "play" | "shuffle" | "play-next" | "queue";

export interface FolderActionRequest {
  path: string;
  recursive?: boolean;
}

export interface FolderActionResult {
  count: number;
  failed: string[];
}

export interface FolderPlaylistRequest extends FolderActionRequest {
  playlistId: string;
}

export interface FolderPlaylistResult extends FolderActionResult {
  added: number;
}

export interface FolderScanRequest {
  path: string;
  incremental: boolean;
}

export interface FolderTextMaterial {
  text: string;
  truncated: boolean;
  size: number;
}
