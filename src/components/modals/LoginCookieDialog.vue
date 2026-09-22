<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { providerClient } from "@/core/providerClient";
import { useUserStore } from "@/stores/user";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import { getPlatformAccountAdapter } from "@/apis/login/platform";
import type { Platform } from "@shared/types/platform";

/**
 * 通用 Cookie 登录弹窗。
 * - netease：校验 MUSIC_U 后用 user store 复核登录态（保持原有行为）
 * - qm/kg：交给 Core 的 set-cookie 校验，再用平台 adapter 复核 profile
 */
const props = withDefaults(defineProps<{ open: boolean; platform?: Platform }>(), {
  platform: "netease",
});
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 登录成功 */
  success: [];
}>();

const { t } = useI18n();
const user = useUserStore();
const providerSessions = useProviderSessionsStore();

const raw = ref("");
const loading = ref(false);

const platformName = computed(() => {
  if (props.platform === "netease") return "NCM";
  return getPlatformAccountAdapter(props.platform).displayName;
});

watch(
  () => props.open,
  (open) => {
    if (!open) {
      raw.value = "";
      loading.value = false;
    }
  },
);

const submit = async (): Promise<void> => {
  const value = raw.value.trim();
  if (!value) {
    toast.error(t("settings.platformLogin.toast.cookieInvalid"));
    return;
  }
  if (props.platform === "netease" && !/MUSIC_U\s*=/i.test(value)) {
    toast.error(t("login.cookieInvalid"));
    return;
  }
  loading.value = true;
  try {
    const res = await providerClient.setCookie(props.platform, value);
    if (!res.ok) {
      toast.error(t("settings.platformLogin.toast.cookieInvalid"));
      return;
    }

    if (props.platform === "netease") {
      if (!(await user.fetchStatus())) {
        toast.error(t("login.failed"));
        return;
      }
    } else {
      const adapter = getPlatformAccountAdapter(props.platform);
      const profile = await adapter.fetchProfile();
      if (!profile) {
        await adapter.logout();
        toast.error(t("settings.platformLogin.toast.cookieInvalid"));
        return;
      }
      await providerSessions.refresh();
    }

    toast.success(
      t("settings.platformLogin.toast.cookieSuccess", { name: platformName.value }),
    );
    emit("success");
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
};

const hint = computed(() =>
  props.platform === "netease" ? t("login.cookieHint") : t("settings.platformLogin.cookieHint"),
);

const onOpenUpdate = (value: boolean): void => emit("update:open", value);
</script>

<template>
  <SDialog
    :open="open"
    :title="
      platform === 'netease' ? t('login.manualCookie') : t('settings.platformLogin.cookieTitle', { name: platformName })
    "
    width="420px"
    @update:open="onOpenUpdate"
  >
    <div class="flex flex-col gap-3">
      <SAlert>{{ hint }}</SAlert>
      <SInput
        v-model="raw"
        type="textarea"
        :rows="4"
        clearable
        :placeholder="t('settings.platformLogin.cookiePlaceholder')"
        :disabled="loading"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="loading" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :loading="loading" @click="submit">
        {{ t("login.cookieConfirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
