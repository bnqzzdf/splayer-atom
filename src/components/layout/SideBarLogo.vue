<script setup lang="ts">
defineProps<{
  collapsed: boolean;
}>();

const router = useRouter();

const goHome = (): void => {
  router.push("/");
};
</script>

<template>
  <div class="flex items-center justify-center h-16 shrink-0 px-4">
    <div
      role="link"
      tabindex="0"
      class="inline-flex items-center cursor-pointer transform-gpu transition-transform duration-300 hover:scale-105 active:scale-100"
      @click="goHome"
    >
      <SLogo :size="30" class="shrink-0" />
      <span
        class="inline-flex h-8 items-center gap-2 overflow-hidden whitespace-nowrap text-primary transition-[width,opacity,margin] duration-300"
        :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-[140px] opacity-100 ml-2'"
      >
        <span class="font-logo text-[22px] leading-none">SPlayer</span>
        <span
          class="inline-flex h-5 items-center rounded-full border border-solid border-primary/20 bg-primary/8 px-2 text-[9px] font-semibold leading-none tracking-[0.14em]"
        >
          ATOM
        </span>
      </span>
    </div>
  </div>
</template>
