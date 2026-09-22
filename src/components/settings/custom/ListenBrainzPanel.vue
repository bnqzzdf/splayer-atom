<script setup lang="ts">
import type { ListenBrainzStatus } from "@shared/types/listenbrainz";
import { listenbrainzClient } from "@/core/listenbrainzClient";
import { toast } from "@/composables/useToast";
import IconLucideHeadphones from "~icons/lucide/headphones";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideUnplug from "~icons/lucide/unplug";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const status = ref<ListenBrainzStatus>({
  enabled: false,
  sendNowPlaying: true,
  linked: false,
  account: null,
  state: "disabled",
  pending: 0,
  dead: 0,
  lastError: null,
  processActive: false,
});
const token = ref("");
const busy = ref(false);

const refresh = async (): Promise<void> => {
  status.value = await listenbrainzClient.getStatus();
};

onMounted(refresh);

const handleLink = async (): Promise<void> => {
  const value = token.value.trim();
  if (!value) return;
  busy.value = true;
  try {
    status.value = await listenbrainzClient.link(value);
    token.value = "";
    toast.success(t("settings.listenbrainz.toast.connected", { name: status.value.account ?? "" }));
  } catch (error) {
    toast.error(
      t("settings.listenbrainz.toast.failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    busy.value = false;
  }
};

const handleUnlink = async (): Promise<void> => {
  busy.value = true;
  try {
    status.value = await listenbrainzClient.unlink();
    toast.success(t("settings.listenbrainz.toast.disconnected"));
  } finally {
    busy.value = false;
  }
};

const handleClearOutbox = async (): Promise<void> => {
  busy.value = true;
  try {
    status.value = await listenbrainzClient.clearOutbox();
    toast.success(t("settings.listenbrainz.toast.cleared"));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div
          class="size-10 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
        >
          <IconLucideHeadphones class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-on-surface truncate">
            {{
              status.linked
                ? t("settings.listenbrainz.connectedAs", { name: status.account ?? "" })
                : t("settings.listenbrainz.notConnected")
            }}
          </div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t(`settings.listenbrainz.state.${status.state}`) }}
            <span v-if="status.pending || status.dead">
              ·
              {{ t("settings.listenbrainz.queue", { pending: status.pending, dead: status.dead }) }}
            </span>
          </div>
          <div v-if="status.lastError" class="text-xs text-error mt-1 break-words">
            {{ status.lastError }}
          </div>
        </div>
      </div>

      <SButton
        v-if="status.linked"
        variant="secondary"
        size="small"
        type="error"
        :loading="busy"
        @click="handleUnlink"
      >
        <template #icon><IconLucideUnplug class="size-4" /></template>
        {{ t("settings.listenbrainz.disconnect") }}
      </SButton>
    </div>

    <div v-if="!status.linked" class="flex items-center gap-2">
      <SInput
        v-model="token"
        type="password"
        autocomplete="new-password"
        :placeholder="t('settings.listenbrainz.tokenPlaceholder')"
        @keydown.enter="handleLink"
      />
      <SButton type="primary" :loading="busy" :disabled="!token.trim()" @click="handleLink">
        {{ t("settings.listenbrainz.connect") }}
      </SButton>
    </div>

    <div v-if="status.pending || status.dead" class="flex justify-end">
      <SButton
        variant="secondary"
        size="small"
        type="error"
        :disabled="busy"
        @click="handleClearOutbox"
      >
        <template #icon><IconLucideTrash2 class="size-4" /></template>
        {{ t("settings.listenbrainz.clearOutbox") }}
      </SButton>
    </div>
  </div>
</template>
