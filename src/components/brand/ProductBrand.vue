<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: "sidebar" | "about";
  }>(),
  { size: "sidebar" },
);

const nameClass = computed(() => (props.size === "sidebar" ? "text-[22px]" : "text-lg"));
</script>

<template>
  <span class="inline-flex items-center gap-2 whitespace-nowrap">
    <span class="font-logo leading-none" :class="nameClass">SPlayer</span>
    <span
      class="inline-flex h-5 items-center rounded-full border border-solid border-primary/20 bg-primary/8 px-2 text-[9px] font-semibold leading-none tracking-[0.14em]"
    >
      ATOM
    </span>
  </span>
</template>
