<script setup lang="ts">
import StreamingLoginDialog from "@/components/modals/StreamingLoginDialog.vue";
import QrLoginPanel from "@/components/modals/QrLoginPanel.vue";
import LoginCookieDialog from "@/components/modals/LoginCookieDialog.vue";
import { toast } from "@/composables/useToast";
import { providerClient } from "@/core/providerClient";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import { useUserStore } from "@/stores/user";
import { getPlatformAccountAdapter, type QrLoginAdapter } from "@/apis/login/platform";
import type { Platform, PlatformProfile } from "@shared/types/platform";

/**
 * 在线平台账号行。
 *
 * 两种形态：
 * - 托管式（Qobuz / TIDAL）：登录态由 Core 的 provider session 投影，弹窗内做网页/设备授权。
 * - 账号式（网易云 / QM / KG）：adapter 提供 profile / Cookie / 扫码，扫码走 Core 的 login_qr_* 模块。
 */
const props = defineProps<{ platform: Platform }>();

const { t } = useI18n();
const providerSessions = useProviderSessionsStore();
const user = useUserStore();

const isStreaming = computed(() => props.platform === "qobuz" || props.platform === "tidal");
/**
 * 账号式平台：登录态是自己去查 profile 得到的（扫码 / Cookie），
 * 与托管式的 provider session 投影不是一回事。
 */
const ACCOUNT_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(["netease", "qqmusic", "kugou"]);
const isAccount = computed(() => ACCOUNT_PLATFORMS.has(props.platform));

/** adapter 注册表当前覆盖全部五个托管平台。 */
const adapter = computed(() =>
  isAccount.value ? getPlatformAccountAdapter(props.platform) : null,
);

const platformName = computed(() => {
  if (props.platform === "qobuz") return "Qobuz";
  if (props.platform === "tidal") return "TIDAL";
  return adapter.value?.displayName ?? props.platform;
});

const session = computed(() => providerSessions.sessions[props.platform]);
const accountName = computed(
  () => session.value.username || session.value.userId || platformName.value,
);

const refreshSession = async (): Promise<void> => {
  try {
    await providerSessions.refresh();
  } catch (error) {
    console.warn(`[provider-account] ${props.platform} session refresh failed`, error);
  }
};

/**
 * 网易的账号态有两处投影：providerSessions（Core 侧）与 user store（头像栏、首页读它）。
 * 扫码 / Cookie 登录与退出都要把 store 拉回同步，否则头像栏会停在旧状态。
 */
const syncNeteaseStore = async (): Promise<void> => {
  if (props.platform !== "netease") return;
  try {
    await user.fetchStatus();
  } catch (error) {
    console.warn("[provider-account] netease store sync failed", error);
  }
};

/** ---------- 托管式（Qobuz / TIDAL） ---------- */
const dialogOpen = ref(false);
const disconnecting = ref(false);

/**
 * 断开托管式平台（Qobuz / TIDAL）。
 *
 * 这里**不**等 `refreshSession()` 再复位按钮：会话投影由 Core 主动推送
 * （providerSessions 事件，store 已订阅），`getSessions` 只是兜底核对。
 * 之前把这次多余的往返放在关键路径上，网络一慢按钮就一直转圈。
 */
const disconnect = async (): Promise<void> => {
  if (disconnecting.value) return;
  disconnecting.value = true;
  try {
    await providerClient.clearSession(props.platform);
    toast.success(t("settings.platformLogin.toast.logoutDone", { name: platformName.value }));
  } catch (error) {
    console.error(`[provider-account] ${props.platform} disconnect failed`, error);
    toast.error(t("settings.platformLogin.toast.logoutFailed", { name: platformName.value }));
  } finally {
    disconnecting.value = false;
  }
  void refreshSession();
};

watch(dialogOpen, (open) => {
  if (!open) void refreshSession();
});

/** ---------- 账号式（QM / KG） ---------- */
const profile = ref<PlatformProfile | null>(null);
const qrModalOpen = ref(false);
const cookieModalOpen = ref(false);
const confirmOpen = ref(false);
const selectedQrKey = ref("qq");

const qrOptions = computed(() => adapter.value?.qrLoginOptions ?? []);

const activeQrAdapter = computed<QrLoginAdapter | null>(() => {
  const options = qrOptions.value;
  if (options.length > 0) {
    return (options.find((o) => o.key === selectedQrKey.value) ?? options[0]).adapter;
  }
  return adapter.value?.qrLogin ?? null;
});

const currentQrTitle = computed(() => {
  const options = qrOptions.value;
  if (options.length === 0) return "";
  const hit = options.find((o) => o.key === selectedQrKey.value) ?? options[0];
  return t(hit.labelKey);
});

const refreshProfile = async (): Promise<void> => {
  if (!adapter.value) return;
  try {
    profile.value = await adapter.value.fetchProfile();
  } catch (error) {
    console.warn(`[platform-account] ${props.platform} fetch profile failed`, error);
    profile.value = null;
  }
};

watch(
  () => `${props.platform}:${String(session.value.authenticated)}`,
  () => {
    if (isAccount.value) void refreshProfile();
  },
  { immediate: true },
);

const openQrModal = (key?: string): void => {
  if (key) selectedQrKey.value = key;
  else if (qrOptions.value.length > 0) selectedQrKey.value = qrOptions.value[0].key;
  qrModalOpen.value = true;
};

const handleQrSuccess = async (): Promise<void> => {
  await refreshSession();
  await syncNeteaseStore();
  await refreshProfile();
  qrModalOpen.value = false;
  toast.success(
    t("settings.platformLogin.toast.loginSuccess", {
      name: platformName.value,
      user: profile.value?.nickname || accountName.value,
    }),
  );
};

/** 手动 Cookie 登录成功：与扫码登录走同一套状态同步 */
const handleCookieSuccess = async (): Promise<void> => {
  await refreshSession();
  await syncNeteaseStore();
  await refreshProfile();
};

const handleLogout = async (): Promise<void> => {
  confirmOpen.value = false;
  if (!adapter.value) return;
  try {
    await adapter.value.logout();
  } finally {
    profile.value = null;
    await refreshSession();
    await syncNeteaseStore();
    toast.success(t("settings.platformLogin.toast.logoutDone", { name: platformName.value }));
  }
};

const loggedIn = computed(() =>
  isStreaming.value ? session.value.authenticated : Boolean(profile.value),
);
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
  >
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <span
        v-if="isAccount && profile?.avatarUrl"
        class="size-10 rounded-full overflow-hidden bg-on-surface/10 flex items-center justify-center shrink-0 border border-solid border-outline-variant/20"
      >
        <img
          :src="profile.avatarUrl"
          alt="avatar"
          class="size-full object-cover"
          referrerpolicy="no-referrer"
        />
      </span>
      <div
        v-else
        class="size-10 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
      >
        <IconLucideMusic class="size-5" />
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-base">
          <STag size="small">{{ platformName }}</STag>
          <span class="truncate">
            {{
              loggedIn && isAccount && profile?.nickname
                ? profile.nickname
                : loggedIn
                  ? accountName
                  : t("settings.platformLogin.title", { name: platformName })
            }}
          </span>
          <STag v-if="isAccount && profile?.isVip" size="small" round>VIP</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5 truncate">
          <template v-if="loggedIn">
            <template v-if="isAccount && adapter">
              {{ adapter.userIdLabel }}: {{ profile?.userId }}
            </template>
            <template v-else>{{ t("settings.platformLogin.connected") }}</template>
          </template>
          <template v-else>{{ t("settings.platformLogin.desc") }}</template>
        </div>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-2">
      <template v-if="loggedIn">
        <SButton
          variant="secondary"
          size="small"
          type="error"
          :loading="disconnecting"
          @click="isAccount ? (confirmOpen = true) : disconnect()"
        >
          <template #icon><IconLucideUnplug class="size-4" /></template>
          {{
            isAccount ? t("settings.platformLogin.logout") : t("settings.platformLogin.disconnect")
          }}
        </SButton>
      </template>
      <template v-else>
        <template v-if="isAccount && adapter">
          <SButton
            v-if="adapter.setCookie"
            variant="secondary"
            size="small"
            @click="cookieModalOpen = true"
          >
            <template #icon><IconLucideKey class="size-3.5" /></template>
            {{ t("settings.platformLogin.manualCookie") }}
          </SButton>
          <SDropdownMenu
            v-if="qrOptions.length > 1"
            :items="qrOptions.map((o) => ({ key: o.key, label: t(o.labelKey) }))"
            @select="(key: string) => openQrModal(key)"
          >
            <template #trigger>
              <SButton variant="secondary" size="small" type="primary">
                <template #icon><IconLucideQrCode class="size-4" /></template>
                {{ t("settings.platformLogin.loginQr") }}
                <template #extra>
                  <IconLucideChevronDown class="size-3.5 ml-0.5 opacity-70" />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
          <SButton
            v-else-if="activeQrAdapter"
            variant="secondary"
            size="small"
            type="primary"
            @click="openQrModal()"
          >
            <template #icon><IconLucideQrCode class="size-4" /></template>
            {{ t("settings.platformLogin.loginQr") }}
          </SButton>
        </template>
        <SButton v-else variant="secondary" size="small" type="primary" @click="dialogOpen = true">
          <template #icon><IconLucideLogIn class="size-4" /></template>
          {{ t("settings.platformLogin.connect") }}
        </SButton>
      </template>
    </div>
  </div>

  <StreamingLoginDialog
    v-if="isStreaming"
    v-model:open="dialogOpen"
    :tab="props.platform === 'tidal' ? 'tidal' : 'qobuz'"
    :single-platform="props.platform === 'tidal' ? 'tidal' : 'qobuz'"
  />

  <SDialog v-if="activeQrAdapter" v-model:open="qrModalOpen" :closable="false" width="380px">
    <div class="flex flex-col items-center gap-4 py-3">
      <div class="flex flex-col items-center gap-2">
        <SLogo :size="48" />
        <div class="text-xl font-semibold text-on-surface">{{ platformName }}</div>
        <div v-if="currentQrTitle" class="text-xs text-on-surface-variant font-medium">
          {{ currentQrTitle }}
        </div>
      </div>
      <QrLoginPanel
        :key="`${props.platform}-${selectedQrKey}`"
        class="mt-2"
        :active="qrModalOpen"
        :adapter="activeQrAdapter"
        @success="handleQrSuccess"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" class="mx-auto" @click="close">
        <template #icon><IconLucideX /></template>
        {{ t("common.cancel") }}
      </SButton>
    </template>
  </SDialog>

  <LoginCookieDialog
    v-if="isAccount"
    :open="cookieModalOpen"
    :platform="props.platform"
    @update:open="(v: boolean) => (cookieModalOpen = v)"
    @success="handleCookieSuccess"
  />

  <SDialog
    v-model:open="confirmOpen"
    :title="t('settings.platformLogin.logoutTitle', { name: platformName })"
    width="400px"
  >
    <p class="text-sm text-on-surface-variant">
      {{
        t("settings.platformLogin.logoutConfirm", {
          name: platformName,
          user: profile?.nickname || "",
        })
      }}
    </p>
    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton variant="secondary" type="error" @click="handleLogout">
        {{ t("common.confirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
