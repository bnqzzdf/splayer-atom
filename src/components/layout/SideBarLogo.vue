<script setup lang="ts">
import ProductBrand from "@/components/brand/ProductBrand.vue";

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
        class="inline-flex h-8 items-center overflow-hidden whitespace-nowrap text-primary transition-[width,opacity,margin] duration-300"
        :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-[140px] opacity-100 ml-2'"
      >
        <ProductBrand />
      </span>
    </div>
  </div>
</template>
