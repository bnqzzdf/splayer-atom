<script setup lang="ts">
import StreamingLoginDialog from "@/components/modals/StreamingLoginDialog.vue";
import { toast } from "@/composables/useToast";
import { providerClient } from "@/core/providerClient";
import { useProviderSessionsStore } from "@/stores/providerSessions";

const props = defineProps<{ platform: "qobuz" | "tidal" }>();
const { t } = useI18n();
const providerSessions = useProviderSessionsStore();

const dialogOpen = ref(false);
const disconnecting = ref(false);

const platformName = computed(() => (props.platform === "qobuz" ? "Qobuz" : "TIDAL"));
const session = computed(() => providerSessions.sessions[props.platform]);
const accountName = computed(
  () => session.value.username || session.value.userId || platformName.value,
);

const refresh = async (): Promise<void> => {
  try {
    await providerSessions.refresh();
  } catch (error) {
    console.warn(`[provider-account] ${props.platform} session refresh failed`, error);
  }
};

const disconnect = async (): Promise<void> => {
  if (disconnecting.value) return;
  disconnecting.value = true;
  try {
    await providerClient.clearSession(props.platform);
    await refresh();
    toast.success(t("settings.platformLogin.toast.logoutDone", { name: platformName.value }));
  } catch (error) {
    console.error(`[provider-account] ${props.platform} disconnect failed`, error);
    toast.error(t("settings.platformLogin.toast.logoutFailed", { name: platformName.value }));
  } finally {
    disconnecting.value = false;
  }
};

watch(dialogOpen, (open) => {
  if (!open) void refresh();
});
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
  >
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <div
        class="size-10 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
      >
        <IconLucideMusic class="size-5" />
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-base">
          <STag size="small">{{ platformName }}</STag>
          <span class="truncate">
            {{
              session.authenticated
                ? accountName
                : t("settings.platformLogin.title", { name: platformName })
            }}
          </span>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5 truncate">
          {{
            session.authenticated
              ? t("settings.platformLogin.connected")
              : t("settings.platformLogin.desc")
          }}
        </div>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-2">
      <SButton
        v-if="session.authenticated"
        variant="secondary"
        size="small"
        type="error"
        :loading="disconnecting"
        @click="disconnect"
      >
        <template #icon><IconLucideUnplug class="size-4" /></template>
        {{ t("settings.platformLogin.disconnect") }}
      </SButton>
      <SButton v-else variant="secondary" size="small" type="primary" @click="dialogOpen = true">
        <template #icon><IconLucideLogIn class="size-4" /></template>
        {{ t("settings.platformLogin.connect") }}
      </SButton>
    </div>

    <StreamingLoginDialog
      v-model:open="dialogOpen"
      :tab="props.platform"
      :single-platform="props.platform"
    />
  </div>
</template>
