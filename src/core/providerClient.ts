import type {
  ApiCallResponse,
  ManagedProviderPlatform,
  ProviderSessionsSnapshot,
} from "@shared/types/apis";
import { request } from "@/core/controlClient";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

/** Atom 正式 Provider Core Domain client；QQ/酷狗兼容调用不进入这里。 */
export const providerClient = {
  call: (
    platform: ManagedProviderPlatform,
    name: string,
    params?: Record<string, unknown>,
  ): Promise<ApiCallResponse> =>
    request<ApiCallResponse>("/providers/call", json({ platform, name, params })),

  clearSession: async (platform: ManagedProviderPlatform): Promise<void> => {
    await request("/providers/clear-session", json({ platform }));
  },

  getSessions: (): Promise<ProviderSessionsSnapshot> =>
    request<ProviderSessionsSnapshot>("/providers/sessions"),

  setCookie: (
    platform: ManagedProviderPlatform,
    cookie: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    request<{ ok: true } | { ok: false; error: string }>(
      "/providers/set-cookie",
      json({ platform, cookie }),
    ),
};
