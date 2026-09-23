import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode } from "../../shared/types/errors";
import { shouldSkipDjTrack } from "../../shared/utils/djMode";
import {
  classifyPluginFailureMessage,
  isSkippablePlaybackError,
  neteaseUnavailableErrorCode,
  nextPlaybackPreloadIndex,
  playbackSourceCacheKey,
  pluginUnavailableErrorCode,
  shouldRetryPlaybackSource,
} from "./playbackSourcePolicy";

const base = { id: "42" };

describe("playbackSourceCacheKey", () => {
  it("keeps local tracks outside the song cache", () => {
    assert.equal(playbackSourceCacheKey({ ...base, source: "local" }, "lossless"), null);
  });

  it("uses server and original ids for streaming tracks", () => {
    assert.equal(
      playbackSourceCacheKey(
        { ...base, source: "streaming", serverId: "server-a", originalId: "remote-7" },
        "lossless",
      ),
      "s:server-a:remote-7:",
    );
  });

  it("includes Core quality policy for Atom-owned online providers", () => {
    for (const source of ["netease", "qobuz", "tidal"] as const) {
      assert.equal(playbackSourceCacheKey({ ...base, source }, "hi-res"), `o:${source}:42:hi-res`);
    }
  });

  it("preserves inherited QQ/Kugou cache-key compatibility without claiming Core resolution", () => {
    assert.equal(playbackSourceCacheKey({ ...base, source: "qqmusic" }, "hq"), "o:qqmusic:42:");
    assert.equal(playbackSourceCacheKey({ ...base, source: "kugou" }, "hq"), "o:kugou:42:");
  });
});

describe("isSkippablePlaybackError", () => {
  it("allows Core to advance past track-scoped source failures", () => {
    for (const code of [
      ErrorCode.FILE_NOT_FOUND,
      ErrorCode.FILE_DECODE_ERROR,
      ErrorCode.NETWORK_ERROR,
      ErrorCode.URL_RESOLVE_FAILED,
      ErrorCode.NETEASE_VIP_REQUIRED,
      ErrorCode.NETEASE_PURCHASE_REQUIRED,
      ErrorCode.NETEASE_TRIAL_DISABLED,
      ErrorCode.PROVIDER_VIP_REQUIRED,
      ErrorCode.PROVIDER_PURCHASE_REQUIRED,
      ErrorCode.PROVIDER_TRIAL_DISABLED,
      ErrorCode.PROVIDER_UNAVAILABLE,
      ErrorCode.PROVIDER_LOGIN_REQUIRED,
      ErrorCode.OUTPUT_FORMAT_UNSUPPORTED,
    ]) {
      assert.equal(isSkippablePlaybackError(code), true);
    }
  });

  it("keeps device and unknown failures outside automatic queue advancement", () => {
    assert.equal(isSkippablePlaybackError(ErrorCode.DEVICE_NOT_FOUND), false);
    assert.equal(isSkippablePlaybackError(ErrorCode.DEVICE_INIT_FAILED), false);
    assert.equal(isSkippablePlaybackError(ErrorCode.OUTPUT_DEVICE_REQUIRED), false);
    assert.equal(isSkippablePlaybackError(ErrorCode.UNKNOWN), false);
  });
});

describe("neteaseUnavailableErrorCode", () => {
  it("distinguishes VIP entitlement from fee=4 digital purchase restriction", () => {
    assert.equal(neteaseUnavailableErrorCode(1), ErrorCode.NETEASE_VIP_REQUIRED);
    assert.equal(neteaseUnavailableErrorCode("4"), ErrorCode.NETEASE_PURCHASE_REQUIRED);
    assert.equal(neteaseUnavailableErrorCode(0), ErrorCode.NETEASE_UNAVAILABLE);
  });
});

describe("pluginUnavailableErrorCode", () => {
  it("maps a structured plugin reason onto the platform-neutral codes", () => {
    assert.equal(pluginUnavailableErrorCode("vip"), ErrorCode.PROVIDER_VIP_REQUIRED);
    assert.equal(pluginUnavailableErrorCode("purchase"), ErrorCode.PROVIDER_PURCHASE_REQUIRED);
    assert.equal(pluginUnavailableErrorCode("trial"), ErrorCode.PROVIDER_TRIAL_DISABLED);
    assert.equal(pluginUnavailableErrorCode("unavailable"), ErrorCode.PROVIDER_UNAVAILABLE);
  });
});

describe("classifyPluginFailureMessage", () => {
  it("recovers entitlement reasons from legacy lx plugins that only throw text", () => {
    assert.equal(
      classifyPluginFailureMessage("需要购买数字专辑"),
      ErrorCode.PROVIDER_PURCHASE_REQUIRED,
    );
    assert.equal(classifyPluginFailureMessage("仅提供试听片段"), ErrorCode.PROVIDER_TRIAL_DISABLED);
    assert.equal(classifyPluginFailureMessage("需要VIP会员"), ErrorCode.PROVIDER_VIP_REQUIRED);
    assert.equal(classifyPluginFailureMessage("该歌曲无版权"), ErrorCode.PROVIDER_UNAVAILABLE);
  });

  it("stays conservative instead of inventing an entitlement conclusion", () => {
    for (const message of ["request timeout", "socket hang up", "", undefined, 42]) {
      assert.equal(classifyPluginFailureMessage(message), null);
    }
  });
});

describe("shouldRetryPlaybackSource", () => {
  it("allows exactly one fresh resolve for non-local playback", () => {
    assert.equal(shouldRetryPlaybackSource({ source: "netease" }, 0), true);
    assert.equal(shouldRetryPlaybackSource({ source: "streaming" }, 0), true);
    assert.equal(shouldRetryPlaybackSource({ source: "qobuz" }, 1), false);
  });

  it("never retries local files through the provider resolver", () => {
    assert.equal(shouldRetryPlaybackSource({ source: "local" }, 0), false);
  });
});

describe("nextPlaybackPreloadIndex", () => {
  it("preloads the next stable queue item and wraps list playback", () => {
    assert.equal(nextPlaybackPreloadIndex(0, 3, "list", "off"), 1);
    assert.equal(nextPlaybackPreloadIndex(2, 3, "list", "off"), 0);
  });

  it("does not pre-resolve repeat-one, one-item, or shuffle rollover candidates", () => {
    assert.equal(nextPlaybackPreloadIndex(0, 3, "one", "off"), null);
    assert.equal(nextPlaybackPreloadIndex(2, 3, "off", "off"), null);
    assert.equal(nextPlaybackPreloadIndex(0, 1, "list", "off"), null);
    assert.equal(nextPlaybackPreloadIndex(2, 3, "list", "on"), null);
  });

  it("skips Core-policy filtered tracks before staging the next input", () => {
    const skipped = new Set([1, 2]);
    assert.equal(
      nextPlaybackPreloadIndex(0, 4, "list", "off", (index) => skipped.has(index)),
      3,
    );
    assert.equal(
      nextPlaybackPreloadIndex(0, 3, "list", "off", (index) => index !== 0),
      null,
    );
  });
});

describe("shouldSkipDjTrack", () => {
  it("uses one shared predicate for Core and legacy renderer compatibility", () => {
    assert.equal(shouldSkipDjTrack({ title: "车载 DJ 热歌", artists: [] }), true);
    assert.equal(
      shouldSkipDjTrack({ title: "Piano Sonata", artists: [{ id: "a", name: "Artist" }] }),
      false,
    );
  });
});
