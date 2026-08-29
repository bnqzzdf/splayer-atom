import type { ManagedProviderPlatform, ProviderSessionsSnapshot } from "@shared/types/apis";
import { providerClient } from "@/core/providerClient";
import { subscribeCoreControlEvent } from "@/core/controlEventClient";

const EMPTY_SESSIONS: ProviderSessionsSnapshot = {
  netease: { authenticated: false },
  qobuz: { authenticated: false },
  tidal: { authenticated: false },
};

/** Control 侧只投影 Core provider session，不持久化任何登录凭据。 */
export const useProviderSessionsStore = defineStore("providerSessions", () => {
  const sessions = ref<ProviderSessionsSnapshot>(structuredClone(EMPTY_SESSIONS));
  let unsubscribe: (() => void) | null = null;

  const apply = (snapshot: ProviderSessionsSnapshot): void => {
    sessions.value = snapshot;
  };

  const refresh = async (): Promise<void> => {
    apply(await providerClient.getSessions());
  };

  const start = (): void => {
    if (unsubscribe) return;
    unsubscribe = subscribeCoreControlEvent("providerSessions", apply);
    void refresh();
  };

  const isAuthenticated = (platform: ManagedProviderPlatform): boolean =>
    sessions.value[platform].authenticated;

  start();

  return { sessions, refresh, isAuthenticated };
});
