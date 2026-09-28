<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { ControlAction } from "@/actions/model";
import { controlActionsToMenuItems } from "@/actions/menu";
import artistFallback from "@/assets/images/artist.jpg";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist */
  type?: "default" | "artist";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
  /** 当前卡片可用的共享业务动作。 */
  actions?: ControlAction[];
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
});

const emit = defineEmits<{ click: []; action: [actionId: string] }>();

const menuItems = computed(() => controlActionsToMenuItems(props.actions ?? []));
const hasActions = computed(() => menuItems.value.some((item) => item.show !== false));
const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="$emit('click')"
  >
    <!-- 封面 -->
    <div class="relative overflow-hidden group-hover:will-change-transform" :class="coverRounded">
      <SImg
        :src="item.cover"
        :fallback="actualFallback"
        :alt="item.title"
        class="w-full aspect-square transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
      />
      <!-- 音质角标：官方也把 Hi-Res 压在封面左上角。
           压在深色蒙层上，任何封面上都读得清；配色沿用列表里的音质标签。 -->
      <span
        v-if="item.badge"
        class="absolute top-2 left-2 z-2 rounded border border-solid border-amber-500/40 bg-black/45 px-1.5 text-[10px] leading-[18px] font-bold text-amber-500 backdrop-blur-sm"
      >
        {{ item.badge }}
      </span>
      <!-- 业务动作入口 -->
      <div v-if="hasActions" class="absolute top-2 right-2 z-2" @click.stop @pointerdown.stop>
        <SDropdownMenu :items="menuItems" align="end" @select="emit('action', $event)">
          <SButton variant="secondary" circle :size="28" :icon-size="16">
            <template #icon><IconLucideEllipsis /></template>
          </SButton>
        </SDropdownMenu>
      </div>
      <!-- 播放按钮 -->
      <div
        class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
        :class="
          type === 'artist'
            ? 'inset-0 m-auto'
            : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0'
        "
      >
        <IconLucidePlay v-if="type !== 'artist'" class="size-4.5 text-white" />
        <IconLucideUser v-else class="size-8 text-white" />
      </div>
    </div>
    <!-- 信息 -->
    <div
      class="flex flex-col gap-0.5 px-2.5 py-2.5"
      :class="type === 'artist' ? 'items-center' : ''"
    >
      <div
        class="text-sm text-on-surface line-clamp-2 leading-snug text-pretty"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.title }}
      </div>
      <div
        v-if="item.subtitle"
        class="text-xs text-on-surface-variant/50 truncate"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.subtitle }}
      </div>
    </div>
  </div>
</template>
