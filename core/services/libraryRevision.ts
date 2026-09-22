import { publishCoreControlEvent } from "@main/services/coreControlEvents";

let revision = 0;

/** Library canonical content 发生可观察变化时发布轻量 revision。 */
export const publishLibraryRevision = (): number => {
  revision++;
  publishCoreControlEvent({ type: "libraryChanged", data: { revision } });
  return revision;
};

export const getLibraryRevision = (): number => revision;
