<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);

type FontDraftKey =
  "global" | "lyric" | "lyricChinese" | "lyricJapanese" | "lyricKorean" | "lyricLatin";

const draft = reactive<Record<FontDraftKey, string>>({
  global: "",
  lyric: "",
  lyricChinese: "",
  lyricJapanese: "",
  lyricKorean: "",
  lyricLatin: "",
});

const targets: FontDraftKey[] = [
  "global",
  "lyric",
  "lyricChinese",
  "lyricJapanese",
  "lyricKorean",
  "lyricLatin",
];

const syncDraft = (): void => {
  draft.global = settings.appearance.fontFamily;
  draft.lyric = settings.lyric.fontFamily;
  draft.lyricChinese = settings.lyric.fontFamilyChinese;
  draft.lyricJapanese = settings.lyric.fontFamilyJapanese;
  draft.lyricKorean = settings.lyric.fontFamilyKorean;
  draft.lyricLatin = settings.lyric.fontFamilyLatin;
};

watch(open, (value) => {
  if (value) syncDraft();
});

const handleSave = (): void => {
  settings.appearance.fontFamily = draft.global.trim();
  settings.lyric.fontFamily = draft.lyric.trim();
  settings.lyric.fontFamilyChinese = draft.lyricChinese.trim();
  settings.lyric.fontFamilyJapanese = draft.lyricJapanese.trim();
  settings.lyric.fontFamilyKorean = draft.lyricKorean.trim();
  settings.lyric.fontFamilyLatin = draft.lyricLatin.trim();
  open.value = false;
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("common.configure") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.fontConfig.title')"
    :description="t('settings.fontConfig.description')"
    width="620px"
  >
    <div class="flex flex-col gap-2">
      <SCard v-for="key in targets" :key="key" variant="settings" class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {{ t(`settings.fontConfig.fields.${key}`) }}
          </div>
          <SInput
            v-model="draft[key]"
            class="mt-2"
            :placeholder="t('settings.fontConfig.modeCustom')"
          />
        </div>
        <SButton variant="ghost" circle @click="draft[key] = ''">
          <template #icon><IconLucideRotateCcw /></template>
        </SButton>
      </SCard>
    </div>
    <template #footer="{ close }">
      <div class="flex justify-end gap-2">
        <SButton variant="ghost" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton type="primary" @click="handleSave">{{ t("common.save") }}</SButton>
      </div>
    </template>
  </SDialog>
</template>
