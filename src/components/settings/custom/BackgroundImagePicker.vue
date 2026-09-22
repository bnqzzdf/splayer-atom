<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import IconLucideImage from "~icons/lucide/image";
import IconLucideImagePlus from "~icons/lucide/image-plus";
import IconLucideX from "~icons/lucide/x";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const theme = useThemeStore();

const picking = ref(false);

/** 从浏览器选择本地背景图并以 data URL 保存在 Control 本地状态。 */
const handlePick = async (): Promise<void> => {
  if (picking.value) return;
  picking.value = true;
  try {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;
    theme.imageBackground.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  } finally {
    picking.value = false;
  }
};

/** 清除 */
const handleClear = (): void => {
  theme.imageBackground.src = "";
};
</script>

<template>
  <div class="flex items-center gap-3">
    <!-- 横向预览（背景图基本都是横屏，正方形会过度裁剪） -->
    <div
      class="w-24 h-14 shrink-0 rounded-lg border border-solid border-outline-variant/30 overflow-hidden bg-on-surface/5 flex items-center justify-center"
    >
      <img
        v-if="theme.imageBackground.src"
        :src="theme.imageBackground.src"
        class="w-full h-full object-cover"
        draggable="false"
        alt=""
      />
      <IconLucideImage v-else class="size-6 text-on-surface-variant/50" />
    </div>
    <SButton
      variant="secondary"
      size="small"
      circle
      :loading="picking"
      :title="
        theme.imageBackground.src
          ? t('settings.backgroundImage.replace')
          : t('settings.backgroundImage.select')
      "
      @click="handlePick"
    >
      <template #icon><IconLucideImagePlus /></template>
    </SButton>
    <SButton
      v-if="theme.imageBackground.src"
      variant="ghost"
      size="small"
      circle
      :title="t('settings.backgroundImage.clear')"
      @click="handleClear"
    >
      <template #icon><IconLucideX /></template>
    </SButton>
  </div>
</template>
