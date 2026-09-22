<script setup lang="ts">
import IconLucideSearch from "~icons/lucide/search";

defineProps<{
  /** 输入值 */
  modelValue: string;
  /** 占位文案 */
  placeholder: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  keydown: [event: KeyboardEvent];
}>();
</script>

<template>
  <SInput
    :model-value="modelValue"
    :placeholder="placeholder"
    size="large"
    clearable
    @update:model-value="emit('update:modelValue', $event)"
    @keydown="emit('keydown', $event)"
  >
    <template #prefix>
      <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
    </template>
  </SInput>
</template>
