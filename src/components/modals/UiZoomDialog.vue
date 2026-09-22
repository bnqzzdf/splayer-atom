<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const settings = useSettingsStore();

/** 当前缩放百分比 */
const percent = ref(100);

/** 写入当前浏览器 Control 的缩放配置。 */
const apply = (value: number): void => {
  percent.value = value;
  void settings.setSystem("system.uiZoom", value);
};

/** 恢复默认 100% */
const reset = (): void => apply(100);

// 打开时读取当前 Control 已同步的缩放值
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    percent.value = settings.system.system.uiZoom;
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('uiZoom.title')"
    width="360px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col items-center gap-5 py-2">
      <span class="text-sm text-on-surface-variant">{{ t("uiZoom.range") }}</span>
      <SNumberInput
        :model-value="percent"
        :min="50"
        :max="200"
        :step="5"
        unit="%"
        size="large"
        class="w-50"
        @update:model-value="apply"
      />
    </div>
    <template #footer>
      <SButton variant="secondary" @click="reset">{{ t("uiZoom.reset") }}</SButton>
    </template>
  </SDialog>
</template>
