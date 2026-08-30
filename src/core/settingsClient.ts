import type { CoreSettingsSnapshot } from "@shared/types/settings";
import { request } from "./controlClient";

/** Desktop 与 Web 共用的 Core Settings client。 */
export const settingsClient = {
  getSnapshot: (): Promise<CoreSettingsSnapshot> => request<CoreSettingsSnapshot>("/settings/core"),
  set: async (keyPath: string, value: unknown): Promise<void> => {
    await request("/settings/core", {
      method: "POST",
      body: JSON.stringify({ keyPath, value }),
    });
  },
};
