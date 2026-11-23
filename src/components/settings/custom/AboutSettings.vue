<script setup lang="ts">
import {
  CORE_LOG_LEVELS,
  type CoreInfo,
  type CoreLogLevel,
  type CoreLogLevelSnapshot,
} from "@shared/types/core";
import { getContributors, type Contributor } from "@/apis/github";
import {
  getCoreDiagnostics,
  getCoreInfo,
  getCoreLogLevel,
  setCoreLogLevel,
} from "@/core/controlClient";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import ProductBrand from "@/components/brand/ProductBrand.vue";
import { openExternal } from "@/utils/url";
import { shortCommit } from "@/utils/commit";
import {
  APP_VERSION,
  REPO_URL,
  REPO_NAME,
  HOMEPAGE_URL,
  COPYRIGHT_HOLDER,
  COMMIT_HASH,
  COMMIT_DATE,
} from "@/utils/config";
import IconLucideGithub from "~icons/lucide/github";
import IconLucideRss from "~icons/lucide/rss";
import IconLucideArrowUpRight from "~icons/lucide/arrow-up-right";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

const { t } = useI18n();
const { copy } = useCopyText();
/** 当前连接 Core 的 release / protocol 信息。 */
const coreInfo = shallowRef<CoreInfo | null>(null);
const logLevel = ref<CoreLogLevelSnapshot | null>(null);
const switchingLogLevel = ref(false);
const exportingDiagnostics = ref(false);

const logLevelOptions = CORE_LOG_LEVELS.map((level) => ({
  value: level,
  label: level,
}));

interface EnvItem {
  label: string;
  value?: string;
  url?: string;
}

const knownCommit = (commit: string): boolean => commit !== "unknown" && commit.length > 0;
const coreRuntime = (info: CoreInfo): EnvItem => ({
  label: info.runtime?.name === "bun" ? "Core Bun" : "Core Node.js",
  value: info.runtime?.version ?? info.node,
});

/** 页面只展示用户识别当前运行环境所需的信息。 */
const envItems = computed<EnvItem[]>(() => {
  const info = coreInfo.value;
  const commit = info?.commit ?? COMMIT_HASH;
  const atomVersion = info?.version ?? APP_VERSION;
  return [
    {
      label: "Atom",
      value: knownCommit(commit) ? `${atomVersion} (${shortCommit(commit)})` : atomVersion,
      url: knownCommit(commit) ? `${REPO_URL}/commit/${commit}` : undefined,
    },
    ...(info
      ? [
          coreRuntime(info),
          ...(info.capabilities.diretta && info.direttaSdkRelease
            ? [
                {
                  label: "Diretta",
                  value: info.direttaCpuVariant
                    ? `SDK ${info.direttaSdkRelease} (${info.direttaCpuVariant})`
                    : `SDK ${info.direttaSdkRelease}`,
                },
              ]
            : []),
        ]
      : []),
    ...(info ? [{ label: "OS", value: `${info.platform} ${info.arch}`.trim() }] : []),
  ];
});

/** 完整诊断信息不占用页面空间，仅由复制入口导出。 */
const diagnosticItems = computed<EnvItem[]>(() => {
  const info = coreInfo.value;
  const commit = info?.commit ?? COMMIT_HASH;
  return [
    { label: t("settings.about.coreVersion"), value: info?.version ?? APP_VERSION },
    { label: t("settings.about.commit"), value: commit },
    { label: t("settings.about.date"), value: COMMIT_DATE },
    ...(info
      ? [
          { label: t("settings.about.coreProtocol"), value: `v${info.protocol.version}` },
          {
            label: t("settings.about.sourceTree"),
            value: t(info.sourceDirty ? "settings.about.dirty" : "settings.about.clean"),
          },
          coreRuntime(info),
          ...(info.capabilities.diretta
            ? [
                {
                  label: t("settings.about.direttaSdk"),
                  value: info.direttaSdkRelease?.toString() ?? "unknown",
                },
              ]
            : []),
        ]
      : []),
    ...(info ? [{ label: "OS", value: `${info.platform} ${info.arch}`.trim() }] : []),
  ];
});

/** 复制环境信息 */
const handleCopyEnvInfo = (): void => {
  const info = diagnosticItems.value.map((item) => `${item.label}: ${item.value}`).join("\n");
  copy(info);
};

const formatDiagnosticStamp = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const handleLogLevelChange = async (value: string | number | boolean): Promise<void> => {
  if (switchingLogLevel.value) return;
  const next = String(value) as CoreLogLevel;
  if (!CORE_LOG_LEVELS.includes(next)) return;
  switchingLogLevel.value = true;
  try {
    logLevel.value = await setCoreLogLevel(next);
    toast.success(t("settings.about.logLevelUpdated", { level: logLevel.value.level }));
  } catch (error) {
    console.error("切换日志级别失败:", error);
    toast.error(t("settings.about.logLevelFailed"));
  } finally {
    switchingLogLevel.value = false;
  }
};

const handleExportDiagnostics = async (): Promise<void> => {
  if (exportingDiagnostics.value) return;
  exportingDiagnostics.value = true;
  try {
    const snapshot = await getCoreDiagnostics();
    const version = (snapshot.core.version || APP_VERSION).replace(/[^a-zA-Z0-9._-]/g, "-");
    const filename = `splayer-atom-diagnostics-${version}-${formatDiagnosticStamp(new Date())}.json`;
    const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t("settings.about.exportDiagnosticsSuccess"));
  } catch (error) {
    console.error("导出诊断信息失败:", error);
    toast.error(t("settings.about.exportDiagnosticsFailed"));
  } finally {
    exportingDiagnostics.value = false;
  }
};

interface Dependency {
  name: string;
  description: string;
  url: string;
}

/** 本项目建立在这些开源项目的工作之上。 */
const dependencies = computed<Dependency[]>(() => [
  {
    name: "SPlayer-Next",
    description: t("settings.about.thanks.splayerNext"),
    url: "https://github.com/SPlayer-Dev/SPlayer-Next",
  },
  {
    name: "applemusic-like-lyrics",
    description: t("settings.about.thanks.appleMusicLyrics"),
    url: "https://github.com/Steve-xmh/applemusic-like-lyrics",
  },
  {
    name: "NeteaseCloudMusicApiEnhanced",
    description: t("settings.about.thanks.neteaseApi"),
    url: "https://github.com/neteasecloudmusicapienhanced/api-enhanced",
  },
]);

/** 社区与资讯入口 */
const community = computed(() => [
  { name: REPO_NAME, url: REPO_URL, icon: IconLucideGithub },
  { name: t("settings.about.officialSite"), url: HOMEPAGE_URL, icon: IconLucideRss },
]);

const developers = ref<Contributor[]>([]);
const showAllDevelopers = ref(false);

/** 默认仅展示前 6 位，其余折叠 */
const visibleDevelopers = computed(() =>
  showAllDevelopers.value ? developers.value : developers.value.slice(0, 6),
);
const hasMoreDevelopers = computed(() => developers.value.length > 6);

onMounted(async () => {
  const [coreResult, logLevelResult, contributorsResult] = await Promise.allSettled([
    getCoreInfo(),
    getCoreLogLevel(),
    getContributors(),
  ]);
  if (coreResult.status === "fulfilled") coreInfo.value = coreResult.value;
  else console.error("获取 Core 信息失败:", coreResult.reason);
  if (logLevelResult.status === "fulfilled") logLevel.value = logLevelResult.value;
  else console.error("获取日志级别失败:", logLevelResult.reason);
  if (contributorsResult.status === "fulfilled") developers.value = contributorsResult.value;
  else console.error("获取贡献者失败:", contributorsResult.reason);
});
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- 关于软件 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.aboutApp") }}
      </h3>
      <SCard
        variant="settings"
        :bordered="false"
        radius="xl"
        class="flex flex-wrap items-center gap-4"
      >
        <SLogo :size="34" />
        <div class="flex items-center gap-2 mr-auto text-on-surface">
          <ProductBrand size="about" />
          <STag type="primary" size="small" round>v{{ APP_VERSION }}</STag>
        </div>
      </SCard>
    </section>

    <!-- 特别致谢 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.specialThanks") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <SCard
          v-for="dep in dependencies"
          :key="dep.name"
          variant="settings"
          hoverable
          :bordered="false"
          class="group text-left"
          @click="openExternal(dep.url)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium text-on-surface truncate">{{ dep.name }}</span>
            <IconLucideArrowUpRight
              class="size-3.5 text-on-surface-variant/40 group-hover:text-primary transition-colors"
            />
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 line-clamp-1">
            {{ dep.description }}
          </div>
        </SCard>
      </div>
    </section>

    <!-- 开发人员 -->
    <section v-if="developers.length > 0">
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.developers") }}
      </h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <SCard
          v-for="dev in visibleDevelopers"
          :key="dev.login"
          variant="settings"
          hoverable
          :bordered="false"
          size="small"
          class="flex items-center gap-2.5"
          @click="openExternal(dev.htmlUrl)"
        >
          <SImg
            :src="dev.avatar"
            fallback="./images/avatar.jpg"
            class="size-9 rounded-full shrink-0"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium text-on-surface truncate">{{ dev.login }}</div>
            <div class="text-xs text-on-surface-variant/60 truncate">
              {{ dev.login === COPYRIGHT_HOLDER ? "Author" : "Contributor" }}
            </div>
          </div>
        </SCard>
      </div>
      <SButton
        v-if="hasMoreDevelopers"
        variant="text"
        size="small"
        class="mt-3"
        @click="showAllDevelopers = !showAllDevelopers"
      >
        {{ showAllDevelopers ? t("settings.about.collapse") : t("settings.about.showMore") }}
        <template #icon>
          <IconLucideChevronDown
            class="transition-transform"
            :class="showAllDevelopers && 'rotate-180'"
          />
        </template>
      </SButton>
    </section>

    <!-- 社区与资讯 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.community") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <SCard
          v-for="item in community"
          :key="item.name"
          variant="settings"
          hoverable
          :bordered="false"
          class="flex items-center gap-2.5"
          @click="openExternal(item.url)"
        >
          <component :is="item.icon" class="size-5 text-on-surface-variant shrink-0" />
          <span class="text-sm font-medium text-on-surface truncate">{{ item.name }}</span>
        </SCard>
      </div>
    </section>

    <!-- 环境信息 -->
    <section>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
        <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface">
          <span class="w-0.75 h-4 rounded-full bg-primary" />
          {{ t("settings.section.envInfo") }}
        </h3>
        <div class="flex items-center gap-1.5">
          <SButton
            variant="ghost"
            size="small"
            :disabled="exportingDiagnostics"
            @click="handleExportDiagnostics"
          >
            <template #icon><IconLucideDownload /></template>
            {{ t("settings.about.exportDiagnostics") }}
          </SButton>
          <SButton variant="ghost" circle size="small" @click="handleCopyEnvInfo">
            <template #icon><IconLucideCopy /></template>
          </SButton>
        </div>
      </div>
      <SCard
        variant="settings"
        :bordered="false"
        radius="xl"
        class="break-all select-text space-y-1.5"
      >
        <div
          v-for="item in envItems"
          :key="item.label"
          class="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2"
        >
          <span class="text-on-surface/60 shrink-0">{{ item.label }}:</span>
          <a
            v-if="item.url"
            class="text-on-surface hover:text-primary cursor-pointer flex items-center gap-1 w-fit transition-colors"
            @click.prevent="openExternal(item.url!)"
          >
            {{ item.value }}
            <IconLucideArrowUpRight class="size-3 shrink-0" />
          </a>
          <span v-else class="text-on-surface break-words">{{ item.value }}</span>
        </div>
        <div
          v-if="logLevel"
          class="pt-3 mt-3 border-t border-outline/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 select-none"
        >
          <div class="min-w-0">
            <div class="text-sm text-on-surface">{{ t("settings.about.logLevel") }}</div>
            <div class="text-xs text-on-surface/60">
              {{ t("settings.about.logLevelHint", { level: logLevel.defaultLevel }) }}
            </div>
          </div>
          <div class="w-32 shrink-0">
            <SSelect
              :model-value="logLevel.level"
              :options="logLevelOptions"
              :disabled="switchingLogLevel"
              @update:model-value="handleLogLevelChange"
            />
          </div>
        </div>
      </SCard>
    </section>
  </div>
</template>
