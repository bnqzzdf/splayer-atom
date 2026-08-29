<script setup lang="ts">
import { qobuzCall } from "@/apis/qobuz";
import { tidalCall } from "@/apis/tidal";
import { toast } from "@/composables/useToast";
import { providerClient } from "@/core/providerClient";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import IconLucideKeyRound from "~icons/lucide/key-round";
import IconLucideLogOut from "~icons/lucide/log-out";

const { t } = useI18n();
const providerSessions = useProviderSessionsStore();

const qobuzToken = ref("");
const tidalAccessToken = ref("");
const tidalRefreshToken = ref("");
const tidalClientId = ref("");
const qobuzBusy = ref(false);
const tidalBusy = ref(false);

const qobuzSession = computed(() => providerSessions.sessions.qobuz);
const tidalSession = computed(() => providerSessions.sessions.tidal);

/** 验证并交给 Core 持久化 Qobuz user_auth_token。 */
const connectQobuz = async (): Promise<void> => {
  const token = qobuzToken.value.trim();
  if (!token) return;
  qobuzBusy.value = true;
  try {
    await qobuzCall("auth_login", { user_auth_token: token });
    qobuzToken.value = "";
    await providerSessions.refresh();
    toast.success(t("settings.providerAccounts.qobuz.connected"));
  } catch (error) {
    toast.error(
      t("settings.providerAccounts.connectFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    qobuzBusy.value = false;
  }
};

/** 验证并交给 Core 持久化 TIDAL token；refresh token/client id 均为可选。 */
const connectTidal = async (): Promise<void> => {
  const accessToken = tidalAccessToken.value.trim();
  if (!accessToken) return;
  tidalBusy.value = true;
  try {
    await tidalCall("auth_import", {
      access_token: accessToken,
      refresh_token: tidalRefreshToken.value.trim() || undefined,
      client_id: tidalClientId.value.trim() || undefined,
    });
    tidalAccessToken.value = "";
    tidalRefreshToken.value = "";
    tidalClientId.value = "";
    await providerSessions.refresh();
    toast.success(t("settings.providerAccounts.tidal.connected"));
  } catch (error) {
    toast.error(
      t("settings.providerAccounts.connectFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    tidalBusy.value = false;
  }
};

/** 清除 Core 持有的指定 Provider session。 */
const disconnect = async (platform: "qobuz" | "tidal"): Promise<void> => {
  const busy = platform === "qobuz" ? qobuzBusy : tidalBusy;
  busy.value = true;
  try {
    await providerClient.clearSession(platform);
    await providerSessions.refresh();
    toast.success(t("settings.providerAccounts.disconnected"));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-4">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="font-medium text-on-surface">Qobuz</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/60">
            {{
              qobuzSession.authenticated
                ? t("settings.providerAccounts.connectedAs", {
                    name: qobuzSession.username || qobuzSession.userId || "Qobuz",
                  })
                : t("settings.providerAccounts.qobuz.hint")
            }}
          </div>
        </div>
        <SButton
          v-if="qobuzSession.authenticated"
          variant="secondary"
          size="small"
          type="error"
          :loading="qobuzBusy"
          @click="disconnect('qobuz')"
        >
          <template #icon><IconLucideLogOut class="size-4" /></template>
          {{ t("settings.providerAccounts.disconnect") }}
        </SButton>
      </div>
      <div v-if="!qobuzSession.authenticated" class="mt-3 flex items-center gap-2">
        <SInput
          v-model="qobuzToken"
          class="min-w-0 flex-1"
          type="password"
          autocomplete="off"
          :placeholder="t('settings.providerAccounts.qobuz.placeholder')"
          @keyup.enter="connectQobuz"
        />
        <SButton
          variant="secondary"
          type="primary"
          :loading="qobuzBusy"
          :disabled="!qobuzToken.trim()"
          @click="connectQobuz"
        >
          <template #icon><IconLucideKeyRound class="size-4" /></template>
          {{ t("settings.providerAccounts.verify") }}
        </SButton>
      </div>
    </div>

    <div class="rounded-xl border border-solid border-outline-variant/15 bg-surface-panel p-4">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="font-medium text-on-surface">TIDAL</div>
          <div class="mt-0.5 text-xs text-on-surface-variant/60">
            {{
              tidalSession.authenticated
                ? t("settings.providerAccounts.tidal.connected", {
                    id: tidalSession.username || tidalSession.userId || "TIDAL",
                    country: tidalSession.countryCode || "--",
                  })
                : t("settings.providerAccounts.tidal.hint")
            }}
          </div>
        </div>
        <SButton
          v-if="tidalSession.authenticated"
          variant="secondary"
          size="small"
          type="error"
          :loading="tidalBusy"
          @click="disconnect('tidal')"
        >
          <template #icon><IconLucideLogOut class="size-4" /></template>
          {{ t("settings.providerAccounts.disconnect") }}
        </SButton>
      </div>
      <div v-if="!tidalSession.authenticated" class="mt-3 grid gap-2 md:grid-cols-2">
        <SInput
          v-model="tidalAccessToken"
          type="password"
          autocomplete="off"
          :placeholder="t('settings.providerAccounts.tidal.accessToken')"
        />
        <SInput
          v-model="tidalRefreshToken"
          type="password"
          autocomplete="off"
          :placeholder="t('settings.providerAccounts.tidal.refreshToken')"
        />
        <SInput
          v-model="tidalClientId"
          autocomplete="off"
          :placeholder="t('settings.providerAccounts.tidal.clientId')"
          @keyup.enter="connectTidal"
        />
        <SButton
          variant="secondary"
          type="primary"
          :loading="tidalBusy"
          :disabled="!tidalAccessToken.trim()"
          @click="connectTidal"
        >
          <template #icon><IconLucideKeyRound class="size-4" /></template>
          {{ t("settings.providerAccounts.verify") }}
        </SButton>
      </div>
      <div
        v-if="tidalSession.authenticated && tidalSession.refreshable"
        class="mt-2 text-xs text-on-surface-variant/60"
      >
        {{ t("settings.providerAccounts.tidal.refreshable") }}
      </div>
    </div>
  </div>
</template>
