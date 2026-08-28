<script setup lang="ts">
import type { AudioDevice, PlayerStatus, Track } from "@shared/types/player";
import { headlessClient, type HeadlessSession } from "./client";

const tracks = ref<Track[]>([]);
const query = ref("");
const scanDir = ref("");
const scanning = ref(false);
const session = ref<HeadlessSession>({
  active: false,
  mode: "queue",
  queue: [],
  originalQueue: null,
  index: -1,
  current: null,
  repeat: "list",
  shuffle: "off",
});
const status = ref<PlayerStatus>({
  state: "idle",
  position: 0,
  duration: 0,
  volume: 1,
  speed: 1,
  isFinished: false,
});
const outputs = ref<AudioDevice[]>([]);
const selectedOutput = ref("");
const connected = ref(false);
const busy = ref(false);
const error = ref("");

const filteredTracks = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return tracks.value;
  return tracks.value.filter((track) => {
    const haystack = [
      track.title,
      ...track.artists.map((artist) => artist.name),
      track.album?.name ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(needle);
  });
});

const currentTitle = computed(() => session.value.current?.title ?? "未播放");
const currentArtist = computed(() =>
  session.value.current?.artists.map((artist) => artist.name).join(" / ") || "Atom Headless",
);

const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const run = async (action: () => Promise<void>): Promise<void> => {
  busy.value = true;
  error.value = "";
  try {
    await action();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
};

const refreshSession = async (): Promise<void> => {
  session.value = await headlessClient.session();
};

const refreshStatus = async (): Promise<void> => {
  status.value = await headlessClient.status();
  connected.value = true;
};

const refreshOutputs = async (): Promise<void> => {
  const next = await headlessClient.outputs();
  outputs.value = next.data;
  selectedOutput.value = next.selected ?? "";
};

const refreshAll = async (): Promise<void> => {
  await run(async () => {
    const [library, dirs] = await Promise.all([
      headlessClient.tracks(),
      headlessClient.scanDirs(),
      refreshSession(),
      refreshStatus(),
      refreshOutputs(),
    ]);
    tracks.value = library.data;
    if (!scanDir.value && dirs.data.length > 0) scanDir.value = dirs.data[0];
  });
};

const scanLibrary = (): void => {
  void run(async () => {
    const dir = scanDir.value.trim();
    if (!dir) throw new Error("请输入 Atom 主机上的音乐目录路径");
    scanning.value = true;
    try {
      await headlessClient.setScanDirs([dir]);
      await headlessClient.scanLibrary(false);
      while ((await headlessClient.isScanning()).data) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const library = await headlessClient.tracks();
      tracks.value = library.data;
    } finally {
      scanning.value = false;
    }
  });
};

const playFromLibrary = (track: Track): void => {
  void run(async () => {
    const list = filteredTracks.value;
    const startIndex = list.findIndex((item) => item.id === track.id);
    session.value = await headlessClient.replaceQueue(
      list.map((item) => ({ track: item })),
      Math.max(0, startIndex),
    );
    await refreshStatus();
  });
};

const appendTrack = (track: Track): void => {
  void run(async () => {
    session.value = await headlessClient.appendQueue([{ track }]);
  });
};

const removeQueueItem = (queueIndex: number): void => {
  void run(async () => {
    session.value = await headlessClient.removeQueueIndex(queueIndex);
    await refreshStatus();
  });
};

const togglePlay = (): void => {
  void run(async () => {
    if (status.value.state === "playing") await headlessClient.pause();
    else await headlessClient.play();
    await refreshStatus();
  });
};

const seek = (event: Event): void => {
  const target = Number((event.target as HTMLInputElement).value);
  void run(async () => {
    await headlessClient.seek(target);
    await refreshStatus();
  });
};

const selectOutput = (): void => {
  void run(async () => {
    await headlessClient.selectOutput(selectedOutput.value || null);
    await refreshOutputs();
  });
};

const toggleRepeat = (): void => {
  void run(async () => {
    session.value = await headlessClient.setRepeat(session.value.repeat === "one" ? "list" : "one");
  });
};

const toggleShuffle = (): void => {
  void run(async () => {
    session.value = await headlessClient.setShuffle(session.value.shuffle === "on" ? "off" : "on");
  });
};

let stopEvents: (() => void) | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void refreshAll();
  stopEvents = headlessClient.connectEvents((event) => {
    connected.value = true;
    if (event.type === "session" && event.data) session.value = event.data as HeadlessSession;
    if (event.type === "status") void refreshStatus();
    if (event.type === "ended" || event.type === "sourceError") void refreshSession();
  });
  statusTimer = setInterval(() => {
    void refreshStatus().catch(() => {
      connected.value = false;
    });
  }, 1500);
});

onUnmounted(() => {
  stopEvents?.();
  if (statusTimer) clearInterval(statusTimer);
});
</script>

<template>
  <main class="headless-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">ATOM HEADLESS</div>
        <h1>局域网播放器</h1>
      </div>
      <div class="connection" :class="{ online: connected }">
        <span class="dot" />
        {{ connected ? "已连接" : "未连接" }}
      </div>
    </header>

    <section class="now-card">
      <div class="now-copy">
        <div class="eyebrow">NOW PLAYING</div>
        <h2>{{ currentTitle }}</h2>
        <p>{{ currentArtist }}</p>
      </div>
      <div class="transport">
        <button title="上一首" @click="headlessClient.prev()">⏮</button>
        <button class="primary" title="播放/暂停" @click="togglePlay">
          {{ status.state === "playing" ? "⏸" : "▶" }}
        </button>
        <button title="下一首" @click="headlessClient.next()">⏭</button>
      </div>
      <div class="timeline">
        <span>{{ formatTime(status.position) }}</span>
        <input
          type="range"
          min="0"
          :max="Math.max(status.duration, 1)"
          :value="Math.min(status.position, status.duration || 0)"
          @change="seek"
        />
        <span>{{ formatTime(status.duration) }}</span>
      </div>
      <div class="mode-row">
        <button :class="{ active: session.shuffle === 'on' }" @click="toggleShuffle">随机</button>
        <button :class="{ active: session.repeat === 'one' }" @click="toggleRepeat">
          {{ session.repeat === "one" ? "单曲循环" : "列表循环" }}
        </button>
        <button @click="headlessClient.stop()">停止</button>
      </div>
    </section>

    <section class="output-card">
      <div>
        <div class="eyebrow">OUTPUT</div>
        <strong>音频输出</strong>
      </div>
      <select v-model="selectedOutput" :disabled="busy" @change="selectOutput">
        <option value="">系统默认</option>
        <option v-for="device in outputs" :key="device.id" :value="device.id">
          {{ device.name }}{{ device.id.startsWith("diretta:") ? " · Diretta" : "" }}
        </option>
      </select>
      <button :disabled="busy" @click="refreshOutputs">重新扫描</button>
    </section>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div class="content-grid">
      <section class="panel library-panel">
        <div class="panel-head">
          <div>
            <div class="eyebrow">LIBRARY</div>
            <h3>本地音乐</h3>
          </div>
          <span>{{ filteredTracks.length }} 首</span>
        </div>
        <div class="library-config">
          <input
            v-model="scanDir"
            class="path-input"
            placeholder="主机音乐目录，例如 /media/music"
            @keyup.enter="scanLibrary"
          />
          <button :disabled="busy || scanning" @click="scanLibrary">
            {{ scanning ? "扫描中…" : "扫描目录" }}
          </button>
        </div>
        <input v-model="query" class="search" placeholder="搜索歌曲、艺人或专辑" />
        <div class="track-list">
          <article v-for="track in filteredTracks" :key="track.id" class="track-row">
            <button class="track-main" @click="playFromLibrary(track)">
              <strong>{{ track.title }}</strong>
              <span>
                {{ track.artists.map((artist) => artist.name).join(" / ") || "未知艺人" }}
                <template v-if="track.album?.name"> · {{ track.album.name }}</template>
              </span>
            </button>
            <span class="duration">{{ formatTime(track.duration) }}</span>
            <button class="add" title="加入队列" @click="appendTrack(track)">＋</button>
          </article>
          <div v-if="filteredTracks.length === 0" class="empty">没有匹配的本地音乐</div>
        </div>
      </section>

      <section class="panel queue-panel">
        <div class="panel-head">
          <div>
            <div class="eyebrow">QUEUE</div>
            <h3>播放队列</h3>
          </div>
          <button v-if="session.queue.length" @click="headlessClient.clearQueue().then(refreshSession)">
            清空
          </button>
        </div>
        <div class="queue-list">
          <article
            v-for="(item, queueIndex) in session.queue"
            :key="`${item.track.id}-${queueIndex}`"
            class="queue-row"
            :class="{ current: queueIndex === session.index }"
          >
            <span class="queue-index">{{ queueIndex === session.index ? "▶" : queueIndex + 1 }}</span>
            <div>
              <strong>{{ item.track.title }}</strong>
              <span>{{ item.track.artists.map((artist) => artist.name).join(" / ") }}</span>
            </div>
            <button @click="removeQueueItem(queueIndex)">×</button>
          </article>
          <div v-if="session.queue.length === 0" class="empty">队列为空</div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.headless-shell {
  min-height: 100vh;
  padding: 28px;
  background: #0b0c10;
  color: #f4f5f7;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.topbar,
.output-card,
.panel-head,
.mode-row,
.timeline,
.transport {
  display: flex;
  align-items: center;
}
.topbar {
  justify-content: space-between;
  margin: 0 auto 22px;
  max-width: 1320px;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  margin-top: 4px;
  font-size: clamp(24px, 4vw, 36px);
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.16em;
  color: #8d93a1;
}
.connection {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #9aa0aa;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6b7280;
}
.connection.online .dot {
  background: #42d392;
  box-shadow: 0 0 12px rgba(66, 211, 146, 0.7);
}
.now-card,
.output-card,
.panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.045);
  border-radius: 18px;
}
.now-card {
  max-width: 1320px;
  margin: 0 auto 14px;
  padding: 24px;
}
.now-copy h2 {
  margin-top: 5px;
  font-size: clamp(24px, 5vw, 42px);
}
.now-copy p {
  margin-top: 5px;
  color: #a9afba;
}
.transport {
  justify-content: center;
  gap: 12px;
  margin: 24px 0 18px;
}
button,
select,
.search,
.path-input {
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}
button {
  cursor: pointer;
  padding: 9px 13px;
}
button:hover,
button.active {
  background: rgba(255, 255, 255, 0.12);
}
button.primary {
  width: 56px;
  height: 48px;
  font-size: 22px;
  background: #f4f5f7;
  color: #111318;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.timeline {
  gap: 12px;
  color: #9298a4;
  font-variant-numeric: tabular-nums;
}
.timeline input {
  flex: 1;
}
.mode-row {
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.output-card {
  max-width: 1320px;
  margin: 0 auto 14px;
  gap: 14px;
  padding: 14px 18px;
}
.output-card > div:first-child {
  margin-right: auto;
}
.output-card select {
  min-width: 260px;
  max-width: 48vw;
  padding: 9px 12px;
}
.output-card option {
  color: #111318;
}
.error-banner {
  max-width: 1320px;
  margin: 0 auto 14px;
  padding: 12px 15px;
  border-radius: 12px;
  background: rgba(255, 92, 92, 0.12);
  color: #ffb1b1;
  border: 1px solid rgba(255, 92, 92, 0.2);
}
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.8fr);
  gap: 14px;
  max-width: 1320px;
  margin: 0 auto;
}
.panel {
  min-height: 420px;
  padding: 18px;
}
.panel-head {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-head h3 {
  margin-top: 3px;
  font-size: 20px;
}
.panel-head > span {
  color: #9399a5;
}
.library-config {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.path-input,
.search {
  box-sizing: border-box;
  padding: 11px 13px;
  outline: none;
}
.path-input {
  min-width: 0;
  flex: 1;
}
.search {
  width: 100%;
  margin-bottom: 10px;
}
.track-list,
.queue-list {
  max-height: 58vh;
  overflow: auto;
}
.track-row,
.queue-row {
  display: grid;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
}
.track-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
}
.track-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  min-width: 0;
  padding: 11px 8px;
}
.track-main strong,
.queue-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.track-main span,
.queue-row span:not(.queue-index) {
  margin-top: 3px;
  color: #9298a4;
  font-size: 13px;
}
.duration {
  color: #838995;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.add {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 20px;
}
.queue-row {
  grid-template-columns: 28px minmax(0, 1fr) 34px;
  padding: 8px 2px;
}
.queue-row > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.queue-row.current {
  background: rgba(255, 255, 255, 0.06);
}
.queue-index {
  color: #888f9b;
  text-align: center;
  font-size: 12px;
}
.queue-row.current .queue-index {
  color: #42d392;
}
.queue-row button {
  padding: 5px 9px;
}
.empty {
  padding: 48px 16px;
  text-align: center;
  color: #747b87;
}
@media (max-width: 860px) {
  .headless-shell {
    padding: 16px;
  }
  .content-grid {
    grid-template-columns: 1fr;
  }
  .output-card {
    align-items: stretch;
    flex-wrap: wrap;
  }
  .output-card select {
    min-width: 0;
    max-width: none;
    flex: 1 1 100%;
  }
  .track-list,
  .queue-list {
    max-height: 48vh;
  }
}
</style>
