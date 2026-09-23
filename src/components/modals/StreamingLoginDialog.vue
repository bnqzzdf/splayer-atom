<script setup lang="ts">
/**
 * 流媒体平台登录对话框（Qobuz / TIDAL）
 *
 * Qobuz：**一键浏览器登录**（推荐）
 *   - Core 起一次性回调监听 → 打开官方授权页 → 用户正常登录
 *   - 授权码由本地回调收下并兑换 token，用户不需要 Console / F12 / 复制粘贴
 *   - 兜底仍保留「粘贴 user_auth_token」：非订阅、受限网络或 redirect 被拒时可用
 *   - 邮箱+密码不可用（实测 Qobuz 对该 app_id 连 user/login 都返回 401），故不暴露
 *   - 凭据由 Core 验证并持久化，Control 只读取 providerSessions 投影
 *
 * TIDAL：设备码授权（OAuth2 Device Code Flow）
 *   - 第一步：调用 auth_device_authorization 获取 userCode + verificationUriComplete
 *   - 用户在浏览器打开 link.tidal.com 输入 userCode 完成授权
 *   - 第二步：调用 auth_token_poll 轮询，直到 success/expired/denied
 *   - 也支持用户自定义 Client ID / Client Secret（推荐）
 */

import * as qobuzApi from "@/apis/qobuz";
import { openExternal } from "@/utils/url";
import * as tidalApi from "@/apis/tidal";
import { toast } from "@/composables/useToast";
import { useProviderSessionsStore } from "@/stores/providerSessions";
import type { TidalDeviceAuthorizationResponse } from "@/apis/tidal";
import STabs from "@/components/ui/STabs.vue";
import SAlert from "@/components/ui/SAlert.vue";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

const props = defineProps<{
  open: boolean;
  tab?: "qobuz" | "tidal";
  singlePlatform?: "qobuz" | "tidal";
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:tab": [value: "qobuz" | "tidal"];
}>();

const providerSessions = useProviderSessionsStore();

type Tab = "qobuz" | "tidal";
const activeTab = ref<Tab>(props.singlePlatform ?? props.tab ?? "qobuz");
const qobuzSession = computed(() => providerSessions.sessions.qobuz);
const tidalSession = computed(() => providerSessions.sessions.tidal);

// 单平台卡片只展示对应登录流程；独立调用时仍保留双平台切换。
const tabs = computed<{ key: Tab; label: string }[]>(() => {
  if (props.singlePlatform) {
    return [
      {
        key: props.singlePlatform,
        label: props.singlePlatform === "qobuz" ? "Qobuz" : "TIDAL",
      },
    ];
  }
  return [
    { key: "qobuz", label: "Qobuz" },
    { key: "tidal", label: "TIDAL" },
  ];
});

// 当外部指定平台变化时同步当前页签。
watch(
  () => [props.singlePlatform, props.tab] as const,
  ([singlePlatform, tab]) => {
    activeTab.value = singlePlatform ?? tab ?? activeTab.value;
  },
);
watch(activeTab, (newTab) => emit("update:tab", newTab));

// Qobuz 表单（主路径是一键 OAuth；token 粘贴作为兜底）
const qobuzUserId = ref("");
const qobuzAuthToken = ref("");
const qobuzLoading = ref(false);

/**
 * Qobuz 一键 OAuth 状态。
 * `waiting` 期间原生层正在等浏览器回调（上限 180 秒），界面只展示提示。
 */
const qobuzOauthStatus = ref<"idle" | "waiting" | "success" | "error">("idle");
const qobuzOauthMessage = ref<string>("");
/** 兜底的粘贴 token 表单默认折叠，避免抢主路径的注意力 */
const qobuzAdvancedOpen = ref(false);

// TIDAL 设备码授权状态
const tidalClientId = ref("");
const tidalClientSecret = ref("");
const tidalAdvancedOpen = ref(false);
const tidalDeviceInfo = ref<TidalDeviceAuthorizationResponse | null>(null);
const tidalPollStatus = ref<"idle" | "polling" | "success" | "expired" | "denied" | "error">(
  "idle",
);
const tidalPollMessage = ref<string>("");
const tidalRequestLoading = ref(false);
const tidalPollTimer = ref<ReturnType<typeof setTimeout> | null>(null);

/** TIDAL 轮询状态对应的语义化提示样式 */
const tidalAlertType = computed<"info" | "success" | "error">(() => {
  switch (tidalPollStatus.value) {
    case "success":
      return "success";
    case "expired":
    case "denied":
    case "error":
      return "error";
    default:
      return "info";
  }
});

/** 清理轮询定时器 */
const clearTidalPollTimer = (): void => {
  if (tidalPollTimer.value) {
    clearTimeout(tidalPollTimer.value);
    tidalPollTimer.value = null;
  }
};

/** 打开时刷新登录状态 + 切到未登录的 tab + 重置 TIDAL 状态 */
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      clearTidalPollTimer();
      return;
    }
    await providerSessions.refresh().catch((error) => {
      console.warn("[streaming-login] provider session refresh failed", error);
    });
    qobuzUserId.value = "";
    qobuzAuthToken.value = "";
    qobuzOauthStatus.value = "idle";
    qobuzOauthMessage.value = "";
    // 保留最近一次的 deviceInfo 但重置轮询状态
    tidalPollStatus.value = "idle";
    tidalPollMessage.value = "";
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTidalPollTimer();
});

/** 在新标签/系统浏览器打开 Qobuz 网页播放器，便于用一行命令取 token */
const openQobuzPlayer = (): void => {
  void openExternal("https://play.qobuz.com");
};

/** 一键 OAuth 提示的语义化样式 */
const qobuzOauthType = computed<"info" | "success" | "error">(() => {
  if (qobuzOauthStatus.value === "success") return "success";
  if (qobuzOauthStatus.value === "error") return "error";
  return "info";
});

/**
 * Qobuz 一键浏览器登录。
 *
 * 顺序很重要：先让原生层起好回调监听再打开浏览器，
 * 否则用户可能在监听就绪前就完成了跳转。
 *
 * 回调地址必须用**浏览器能访问到的 Core 地址**（`location.hostname`）：
 * 授权页是在用户 PC 上打开的，写 127.0.0.1 会指向那台 PC，回调回不到设备。
 */
const onQobuzBrowserLogin = async (): Promise<void> => {
  qobuzOauthStatus.value = "waiting";
  qobuzOauthMessage.value = "正在打开 Qobuz 授权页…";
  try {
    const start = await qobuzApi.oauthStart(window.location.hostname);
    if (!start?.url) throw new Error("未能获取 Qobuz 授权地址");

    openExternal(start.url);
    qobuzOauthMessage.value =
      "已打开浏览器，请在 Qobuz 页面登录并授权；完成后本窗口会自动更新，无需返回复制任何东西。";

    // 原生侧会阻塞到回调到达、用户取消或 180 秒超时。
    await qobuzApi.oauthAwait();

    await providerSessions.refresh();
    qobuzOauthStatus.value = "success";
    qobuzOauthMessage.value = "登录成功";
    toast.success("Qobuz 登录成功");
    setTimeout(() => emit("update:open", false), 800);
  } catch (err) {
    qobuzOauthStatus.value = "error";
    qobuzOauthMessage.value = err instanceof Error ? err.message : "Qobuz 浏览器登录失败";
    toast.error(qobuzOauthMessage.value);
  }
};

/** Qobuz 登录（兜底：粘贴 user_auth_token） */
const onQobuzLogin = async (): Promise<void> => {
  const userId = qobuzUserId.value.trim();
  const token = qobuzAuthToken.value.trim();
  if (!token) {
    toast.error("请粘贴 user_auth_token");
    return;
  }
  qobuzLoading.value = true;
  try {
    const result = await qobuzApi.login(userId, token);
    if (result?.status !== "success" && !(result as any)?.user_id && !(result as any)?.user) {
      throw new Error("Qobuz 登录失败");
    }
    await providerSessions.refresh();
    toast.success("Qobuz 登录成功");
    emit("update:open", false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Qobuz 登录失败");
  } finally {
    qobuzLoading.value = false;
  }
};

/** Qobuz 登出 */
const onQobuzLogout = async (): Promise<void> => {
  try {
    await qobuzApi.logout();
    await providerSessions.refresh();
    toast.success("已退出 Qobuz 登录");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "登出失败");
  }
};

// ============ TIDAL 授权码登录（官方客户端，无损） ============
// 官方移动 client 的回调地址 com.player.tidal/auth 在桌面不可达，
// 因此采用「手动粘贴回填」：前端打开授权页 → 用户登录 → 把浏览器地址栏 URL 粘回 → 解析 code 调后端交换 token。
const tidalPkceStatus = ref<"idle" | "waiting" | "success" | "error">("idle");
const tidalPkceMessage = ref<string>("");
const tidalCallbackUrl = ref<string>("");
const tidalExchanging = ref<boolean>(false);

/** PKCE 阶段提示的语义化样式 */
const tidalPkceType = computed<"info" | "success" | "error">(() => {
  if (tidalPkceStatus.value === "success") return "success";
  if (tidalPkceStatus.value === "error") return "error";
  return "info";
});

/** 用官方移动客户端发起授权码登录（PKCE），支持标准 LOSSLESS */
const onTidalAuthorize = async (): Promise<void> => {
  tidalPkceStatus.value = "waiting";
  tidalPkceMessage.value = "正在打开 TIDAL 授权页…";
  tidalCallbackUrl.value = "";
  try {
    const info = await tidalApi.authAuthorize();
    window.open(info.url, "_blank", "noopener");
    tidalPkceMessage.value =
      "请在打开的 TIDAL 页面完成授权；授权后浏览器会跳到 com.player.tidal/auth 报错页（正常现象），请复制地址栏完整 URL 粘贴到下方。";
  } catch (err) {
    tidalPkceStatus.value = "error";
    tidalPkceMessage.value = err instanceof Error ? err.message : "发起授权失败";
    toast.error(tidalPkceMessage.value);
  }
};

/** 从回调 URL / 自定义 scheme 中解析出 code 与 state */
const parseTidalCallback = (raw: string): { code?: string; state?: string } => {
  const text = raw.trim();
  if (!text) return {};
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    try {
      url = new URL(text.replace("com.player.tidal://", "https://com.player.tidal/"));
    } catch {
      return {};
    }
  }
  return {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
  };
};

/** 用户粘贴回调 URL 后，解析 code 并调用后端完成 token 交换 */
const onTidalCompleteLogin = async (): Promise<void> => {
  const { code, state } = parseTidalCallback(tidalCallbackUrl.value);
  if (!code) {
    tidalPkceStatus.value = "error";
    tidalPkceMessage.value = "未能从 URL 中解析出 code，请确认粘贴的是完整的回调地址。";
    return;
  }
  tidalExchanging.value = true;
  try {
    const result = (await tidalApi.authExchange(code, state)) as {
      status?: string;
      message?: string;
    };
    if (result.status !== "success") throw new Error(result.message || "TIDAL 登录失败");
    await providerSessions.refresh();
    tidalPkceStatus.value = "success";
    tidalPkceMessage.value = "登录成功，已获得无损 FLAC 权限";
    toast.success("TIDAL 登录成功（官方客户端）");
    setTimeout(() => emit("update:open", false), 800);
  } catch (err) {
    tidalPkceStatus.value = "error";
    tidalPkceMessage.value = err instanceof Error ? err.message : "兑换失败";
    toast.error(tidalPkceMessage.value);
  } finally {
    tidalExchanging.value = false;
  }
};

// ============ TIDAL 设备码授权 ============

/** 重置 TIDAL 状态 */
const cleanTidalState = (): void => {
  clearTidalPollTimer();
  tidalDeviceInfo.value = null;
  tidalPollStatus.value = "idle";
  tidalPollMessage.value = "";
};

/** 第一步：发起设备码授权 */
const onTidalRequestDeviceCode = async (): Promise<void> => {
  cleanTidalState();
  tidalRequestLoading.value = true;
  try {
    const info = await tidalApi.authDeviceAuthorization(
      tidalClientId.value.trim() || undefined,
      tidalClientSecret.value.trim() || undefined,
    );
    tidalDeviceInfo.value = info;
    tidalPollStatus.value = "polling";
    tidalPollMessage.value = "请在浏览器中完成授权…";
    scheduleNextPoll();
  } catch (err) {
    tidalPollStatus.value = "error";
    tidalPollMessage.value = err instanceof Error ? err.message : "获取设备码失败";
    toast.error(tidalPollMessage.value);
  } finally {
    tidalRequestLoading.value = false;
  }
};

/** 调度下次轮询 */
const scheduleNextPoll = (): void => {
  const info = tidalDeviceInfo.value;
  if (!info) return;
  const intervalSec = Math.max(2, info.interval || 2);
  tidalPollTimer.value = setTimeout(() => {
    onTidalPoll();
  }, intervalSec * 1000);
};

/** 第二步：轮询 token */
const onTidalPoll = async (): Promise<void> => {
  const info = tidalDeviceInfo.value;
  if (!info) return;
  try {
    const res = await tidalApi.authTokenPoll(
      info.deviceCode,
      tidalClientId.value.trim() || undefined,
      tidalClientSecret.value.trim() || undefined,
    );
    if (res.status === "success") {
      tidalPollStatus.value = "success";
      tidalPollMessage.value = `登录成功：${res.username ?? "已登录"}`;
      await providerSessions.refresh();
      toast.success("TIDAL 登录成功");
      clearTidalPollTimer();
      setTimeout(() => emit("update:open", false), 800);
      return;
    }
    if (res.status === "expired") {
      tidalPollStatus.value = "expired";
      tidalPollMessage.value = "设备码已过期，请重新获取";
      clearTidalPollTimer();
      return;
    }
    if (res.status === "denied") {
      tidalPollStatus.value = "denied";
      tidalPollMessage.value = "用户拒绝授权";
      clearTidalPollTimer();
      return;
    }
    if (res.status === "timeout") {
      tidalPollStatus.value = "expired";
      tidalPollMessage.value = "轮询超时，请重新获取";
      clearTidalPollTimer();
      return;
    }
    // pending / slow_down → 继续轮询
    tidalPollStatus.value = "polling";
    tidalPollMessage.value = "等待用户在浏览器中完成授权…";
    scheduleNextPoll();
  } catch (err) {
    tidalPollStatus.value = "error";
    tidalPollMessage.value = err instanceof Error ? err.message : "轮询失败";
    clearTidalPollTimer();
  }
};

/** 复制 userCode 到剪贴板 */
const copyTidalUserCode = async (): Promise<void> => {
  const code = tidalDeviceInfo.value?.userCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast.success("已复制设备码");
  } catch {
    toast.error("复制失败，请手动选中复制");
  }
};

/** 打开浏览器访问 TIDAL 授权链接 */
const openTidalAuthUrl = (): void => {
  const rawUrl =
    tidalDeviceInfo.value?.verificationUriComplete ??
    tidalDeviceInfo.value?.verificationUri ??
    "https://link.tidal.com";
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  window.open(url, "_blank", "noopener");
};

/** TIDAL 登出 */
const onTidalLogout = async (): Promise<void> => {
  try {
    await tidalApi.logout();
    await providerSessions.refresh();
    cleanTidalState();
    toast.success("已退出 TIDAL 登录");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "登出失败");
  }
};

const onOpenUpdate = (value: boolean): void => {
  if (!value) clearTidalPollTimer();
  emit("update:open", value);
};
</script>

<template>
  <SDialog :open="open" title="连接在线平台账号" width="480px" @update:open="onOpenUpdate">
    <STabs v-model="activeTab" :tabs="tabs" type="segment" class="mb-1">
      <!-- Qobuz Tab -->
      <template #qobuz>
        <div class="flex flex-col gap-3 pt-3">
          <!-- 已登录状态 -->
          <div
            v-if="qobuzSession.authenticated"
            class="flex items-center justify-between rounded-lg bg-surface-variant/10 px-3 py-2"
          >
            <div class="flex flex-col">
              <span class="text-sm font-medium text-on-surface">已连接</span>
              <span class="text-xs text-on-surface-variant">
                {{ qobuzSession.username || qobuzSession.userId || "Qobuz" }}
              </span>
            </div>
            <SButton variant="secondary" size="small" type="error" @click="onQobuzLogout">
              断开
            </SButton>
          </div>

          <!-- 登录表单 -->
          <template v-else>
            <!-- 主路径：一键浏览器登录 -->
            <SButton
              :loading="qobuzOauthStatus === 'waiting'"
              type="primary"
              :disabled="qobuzLoading"
              @click="onQobuzBrowserLogin"
            >
              用浏览器登录 Qobuz
            </SButton>
            <p class="text-xs leading-relaxed text-on-surface-variant">
              会打开官方授权页；登录完成后自动回到这里，不需要 Console 或复制粘贴。
            </p>
            <SAlert v-if="qobuzOauthStatus !== 'idle'" :type="qobuzOauthType">
              {{ qobuzOauthMessage }}
            </SAlert>

            <!-- 兜底：粘贴 token（非订阅、受限网络或 redirect 被拒时仍可用） -->
            <button
              type="button"
              class="flex items-center gap-1 self-start text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              @click="qobuzAdvancedOpen = !qobuzAdvancedOpen"
            >
              <IconLucideChevronDown
                class="size-3.5 transition-transform"
                :class="qobuzAdvancedOpen ? 'rotate-180' : ''"
              />
              改用粘贴 Token 登录
            </button>

            <template v-if="qobuzAdvancedOpen">
              <div class="flex flex-col gap-1.5">
                <label class="text-xs text-on-surface-variant">User Auth Token</label>
                <SInput
                  v-model="qobuzAuthToken"
                  type="password"
                  placeholder="粘贴 Qobuz user_auth_token（只需这一项）"
                  :disabled="qobuzLoading"
                />
              </div>
              <SButton :loading="qobuzLoading" variant="secondary" @click="onQobuzLogin">
                验证并连接
              </SButton>
              <div
                class="rounded-lg bg-surface-variant/5 px-3 py-2 text-xs leading-relaxed text-on-surface-variant"
              >
                <p class="mb-1 font-medium text-on-surface">如何获取 token？（30 秒）</p>
                <p>1. 点下面按钮打开并登录 play.qobuz.com</p>
                <p>
                  2. F12 →
                  <span class="text-on-surface">Console</span>
                  标签（不是 Network）
                </p>
                <p>3. 粘贴并回车：</p>
                <code
                  class="my-1 block select-all break-all rounded bg-on-surface/8 px-2 py-1 font-mono text-[11px] text-on-surface"
                >
                  copy(localStorage.getItem('qobuz_user_auth_token'))
                </code>
                <p>4. 回到这里直接 Ctrl+V（已复制到剪贴板）</p>
                <p class="mt-1 opacity-70">无需再翻 Network 请求头，也无需填 user_id。</p>
                <SButton
                  variant="secondary"
                  size="small"
                  class="mt-2"
                  :disabled="qobuzLoading"
                  @click="openQobuzPlayer"
                >
                  打开 Qobuz 网页播放器
                </SButton>
              </div>
            </template>
          </template>
        </div>
      </template>

      <!-- TIDAL Tab -->
      <template #tidal>
        <div class="flex flex-col gap-3 pt-3">
          <!-- 已登录状态 -->
          <div
            v-if="tidalSession.authenticated"
            class="flex items-center justify-between rounded-lg bg-surface-variant/10 px-3 py-2"
          >
            <div class="flex flex-col">
              <span class="text-sm font-medium text-on-surface">已连接 TIDAL</span>
              <span class="text-xs text-on-surface-variant">
                {{ tidalSession.username || tidalSession.userId || "TIDAL" }}
              </span>
            </div>
            <SButton variant="secondary" size="small" type="error" @click="onTidalLogout">
              断开
            </SButton>
          </div>

          <!-- 设备码授权流程 -->
          <template v-else>
            <!-- 官方客户端授权码登录（无损，推荐） -->
            <div class="flex flex-col gap-2">
              <SButton
                type="primary"
                :disabled="tidalPkceStatus === 'waiting'"
                :loading="tidalPkceStatus === 'waiting'"
                @click="onTidalAuthorize"
              >
                使用 TIDAL 网页授权（推荐）
              </SButton>
              <SAlert v-if="tidalPkceStatus !== 'idle'" :type="tidalPkceType">
                {{ tidalPkceMessage }}
              </SAlert>
              <template v-if="tidalPkceStatus === 'waiting'">
                <div class="flex flex-col gap-1.5">
                  <label class="text-xs text-on-surface-variant">粘贴回调 URL</label>
                  <SInput
                    v-model="tidalCallbackUrl"
                    placeholder="https://com.player.tidal/auth?code=...&state=..."
                    :disabled="tidalExchanging"
                  />
                </div>
                <SButton
                  type="primary"
                  :loading="tidalExchanging"
                  :disabled="!tidalCallbackUrl.trim()"
                  @click="onTidalCompleteLogin"
                >
                  完成登录
                </SButton>
                <div
                  class="rounded-lg bg-surface-variant/5 px-3 py-2 text-xs leading-relaxed text-on-surface-variant"
                >
                  <p class="mb-1 font-medium text-on-surface">操作步骤</p>
                  <p>1. 点击上方按钮，在打开的 TIDAL 页面登录并授权</p>
                  <p>2. 浏览器会跳到 com.player.tidal/auth 报错页（正常现象）</p>
                  <p>3. 复制地址栏完整 URL，粘贴到上方输入框，点「完成登录」</p>
                </div>
              </template>
            </div>
            <div class="my-2 border-t border-surface-variant/10"></div>

            <!-- 高级选项（自定义 Client ID / Secret） -->
            <div class="flex flex-col gap-1">
              <SButton
                variant="ghost"
                size="tiny"
                class="self-start text-on-surface-variant"
                @click="tidalAdvancedOpen = !tidalAdvancedOpen"
              >
                <template #icon>
                  <IconLucideChevronDown
                    class="size-3.5 transition-transform duration-200"
                    :class="tidalAdvancedOpen ? 'rotate-180' : ''"
                  />
                </template>
                自定义 Client ID / Secret（可选）
              </SButton>
              <div v-if="tidalAdvancedOpen" class="flex flex-col gap-2 mt-1">
                <div class="flex flex-col gap-1.5">
                  <label class="text-xs text-on-surface-variant">Client ID</label>
                  <SInput
                    v-model="tidalClientId"
                    placeholder="可选，未填则使用客户端内置默认值"
                    :disabled="tidalRequestLoading || tidalPollStatus === 'polling'"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-xs text-on-surface-variant">Client Secret</label>
                  <SInput
                    v-model="tidalClientSecret"
                    type="password"
                    placeholder="可选"
                    :disabled="tidalRequestLoading || tidalPollStatus === 'polling'"
                  />
                </div>
              </div>
            </div>

            <!-- 初始状态：点击获取设备码 -->
            <div v-if="!tidalDeviceInfo" class="flex flex-col gap-2">
              <SButton
                :loading="tidalRequestLoading"
                type="primary"
                @click="onTidalRequestDeviceCode"
              >
                获取设备码
              </SButton>
              <div
                class="rounded-lg bg-surface-variant/5 px-3 py-2 text-xs leading-relaxed text-on-surface-variant"
              >
                <p class="mb-1 font-medium text-on-surface">设备码授权说明</p>
                <p>1. 点击下方按钮生成一次性设备码</p>
                <p>2. 在打开的 TIDAL 页面输入设备码完成授权</p>
                <p>3. 授权后本应用自动获取登录态并保持登录</p>
              </div>
            </div>

            <!-- 轮询中：显示 userCode + 链接 -->
            <div v-else class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5 rounded-lg bg-surface-variant/10 px-3 py-3">
                <span class="text-xs text-on-surface-variant">设备码（userCode）</span>
                <div class="flex items-center gap-2">
                  <code
                    class="flex-1 text-base font-mono font-semibold text-on-surface select-all break-all"
                  >
                    {{ tidalDeviceInfo.userCode }}
                  </code>
                  <SButton variant="secondary" size="small" @click="copyTidalUserCode">
                    复制
                  </SButton>
                </div>
              </div>

              <SButton
                type="primary"
                :disabled="tidalPollStatus === 'success'"
                @click="openTidalAuthUrl"
              >
                在浏览器中打开 TIDAL 授权
              </SButton>

              <!-- 状态消息（语义化 SAlert，替代原先的硬编码绿/红配色） -->
              <SAlert :type="tidalAlertType">
                {{ tidalPollMessage }}
              </SAlert>

              <!-- 失败时重新获取 -->
              <SButton
                v-if="
                  tidalPollStatus === 'expired' ||
                  tidalPollStatus === 'denied' ||
                  tidalPollStatus === 'error'
                "
                variant="secondary"
                size="small"
                @click="onTidalRequestDeviceCode"
              >
                重新获取设备码
              </SButton>
              <SButton
                v-else-if="tidalPollStatus === 'polling'"
                variant="secondary"
                size="small"
                @click="cleanTidalState"
              >
                取消
              </SButton>
            </div>
          </template>
        </div>
      </template>
    </STabs>
  </SDialog>
</template>
