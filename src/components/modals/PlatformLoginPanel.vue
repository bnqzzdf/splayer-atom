<script setup lang="ts">
/**
 * 账号式平台（网易云 / QQ音乐 / 酷狗）的登录面板。
 *
 * 统一登录弹窗里，每个账号式平台页签都渲染它：扫码是主路径，
 * 扫码走不通（受限网络、App 不在手边）时退到「手动 Cookie」；已登录则直接显示账号并可退出。
 *
 * 为什么单独抽一个面板：设置页的行（PlatformAccount）是一行卡片、自带按钮，
 * 塞不进弹窗页签；而登录流程本身必须只有一份实现，否则改一处漏一处。
 */
import QrLoginPanel from "@/components/modals/QrLoginPanel.vue";
import LoginCookieDialog from "@/components/modals/LoginCookieDialog.vue";
import { toast } from "@/composables/useToast";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import { useUserStore } from "@/stores/user";
import { getPlatformAccountAdapter, type QrLoginAdapter } from "@/apis/login/platform";
import type { Platform, PlatformProfile } from "@shared/types/platform";

const props = defineProps<{
  platform: Platform;
  /** 该页签当前是否可见：不可见时暂停扫码轮询 */
  active: boolean;
}>();
const emit = defineEmits<{ success: [] }>();

const { t } = useI18n();
const providerSessions = useProviderSessionsStore();
const user = useUserStore();

const adapter = computed(() => getPlatformAccountAdapter(props.platform));
const platformName = computed(() => adapter.value.displayName);

const profile = ref<PlatformProfile | null>(null);
const selectedQrKey = ref("");
const cookieOpen = ref(false);
const confirmOpen = ref(false);
const loggingOut = ref(false);

/** 扫码方式（QM 有 QQ / 微信两种，其余平台只有一种） */
const qrOptions = computed(() => adapter.value.qrLoginOptions ?? []);
const activeQrAdapter = computed<QrLoginAdapter | null>(() => {
  const options = qrOptions.value;
  if (options.length > 0) {
    return (options.find((o) => o.key === selectedQrKey.value) ?? options[0]).adapter;
  }
  return adapter.value.qrLogin ?? null;
});

/** 拉当前账号资料；失败按未登录处理（面板本来就只为登录服务） */
const refreshProfile = async (): Promise<void> => {
  try {
    profile.value = await adapter.value.fetchProfile();
  } catch (error) {
    console.warn(`[platform-login] ${props.platform} fetch profile failed`, error);
    profile.value = null;
  }
};

// 只在页签可见时取数：五个平台一起打接口既慢又没必要
watch(
  () => [props.platform, props.active] as const,
  ([, active]) => {
    if (active) void refreshProfile();
  },
  { immediate: true },
);

/** 登录态变化（Core 推送）时复核账号资料，避免显示上一个账号 */
watch(
  () => providerSessions.sessions[props.platform]?.authenticated,
  () => {
    if (props.active) void refreshProfile();
  },
);

/**
 * 网易的账号态有两处投影：providerSessions（Core 侧）与 user store（头像栏、首页读它）。
 * 登录 / 退出后都要把 store 拉回同步，否则头像栏会停在旧状态。
 */
const syncNeteaseStore = async (): Promise<void> => {
  if (props.platform !== "netease") return;
  try {
    await user.fetchStatus();
  } catch (error) {
    console.warn("[platform-login] netease store sync failed", error);
  }
};

const handleQrSuccess = async (): Promise<void> => {
  await providerSessions.refresh().catch(() => {});
  await syncNeteaseStore();
  await refreshProfile();
  toast.success(
    t("settings.platformLogin.toast.loginSuccess", {
      name: platformName.value,
      user: profile.value?.nickname || platformName.value,
    }),
  );
  emit("success");
};

/** 手动 Cookie 成功：提示由 LoginCookieDialog 自己给，这里只同步状态 */
const handleCookieSuccess = async (): Promise<void> => {
  await providerSessions.refresh().catch(() => {});
  await syncNeteaseStore();
  await refreshProfile();
  emit("success");
};

const handleLogout = async (): Promise<void> => {
  confirmOpen.value = false;
  loggingOut.value = true;
  try {
    await adapter.value.logout();
    profile.value = null;
    await providerSessions.refresh().catch(() => {});
    await syncNeteaseStore();
    toast.success(t("settings.platformLogin.toast.logoutDone", { name: platformName.value }));
    emit("success");
  } finally {
    loggingOut.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 已连接：显示账号，并给退出入口 -->
    <div
      v-if="profile"
      class="flex items-center justify-between gap-3 rounded-lg bg-surface-variant/10 px-3 py-2"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-solid border-outline-variant/20 bg-on-surface/10"
        >
          <img
            v-if="profile.avatarUrl"
            :src="profile.avatarUrl"
            alt="avatar"
            class="size-full object-cover"
            referrerpolicy="no-referrer"
          />
          <IconLucideUserRound v-else class="size-5 text-on-surface-variant" />
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-sm font-medium text-on-surface">
              {{ profile.nickname }}
            </span>
            <STag v-if="profile.isVip" size="small" round>VIP</STag>
          </div>
          <div class="truncate text-xs text-on-surface-variant">
            {{ adapter.userIdLabel }}: {{ profile.userId }}
          </div>
        </div>
      </div>
      <SButton
        variant="secondary"
        size="small"
        type="error"
        :loading="loggingOut"
        @click="confirmOpen = true"
      >
        <template #icon><IconLucideUnplug class="size-4" /></template>
        {{ t("settings.platformLogin.logout") }}
      </SButton>
    </div>

    <!-- 未连接：扫码 + 手动 Cookie -->
    <template v-else>
      <div v-if="qrOptions.length > 1" class="flex flex-wrap gap-1.5">
        <button
          v-for="option in qrOptions"
          :key="option.key"
          type="button"
          class="rounded-md px-2.5 py-1 text-xs transition-colors"
          :class="
            selectedQrKey === option.key
              ? 'bg-primary/15 text-primary'
              : 'text-on-surface-variant hover:bg-surface-variant/15'
          "
          @click="selectedQrKey = option.key"
        >
          {{ t(option.labelKey) }}
        </button>
      </div>

      <QrLoginPanel
        v-if="activeQrAdapter"
        :key="`${platform}-${selectedQrKey}`"
        :active="active"
        :adapter="activeQrAdapter"
        @success="handleQrSuccess"
      />

      <SButton variant="secondary" size="small" class="self-center" @click="cookieOpen = true">
        <template #icon><IconLucideKey class="size-3.5" /></template>
        {{ t("settings.platformLogin.manualCookie") }}
      </SButton>
    </template>
  </div>

  <LoginCookieDialog
    :open="cookieOpen"
    :platform="platform"
    @update:open="(value: boolean) => (cookieOpen = value)"
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
