import type { ManagedProviderPlatform, ProviderSessionsSnapshot } from "@shared/types/apis";

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
    apply(await window.api.apis.getSessions());
  };

  const start = (): void => {
    if (unsubscribe) return;
    unsubscribe = window.api.apis.onSessionsChange(apply);
    void refresh();
  };

  const isAuthenticated = (platform: ManagedProviderPlatform): boolean =>
    sessions.value[platform].authenticated;

  start();

  return { sessions, refresh, isAuthenticated };
});
