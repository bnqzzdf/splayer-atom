<script setup lang="ts">
import PlatformAccount from "@/components/settings/custom/PlatformAccount.vue";
</script>

<template>
  <div class="flex flex-col gap-3">
    <PlatformAccount platform="qobuz" />
    <PlatformAccount platform="tidal" />
  </div>
</template>
