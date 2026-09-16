import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readlink, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discardPreparedUpnpMedia,
  inferUpnpMime,
  registerMediaFile,
  releaseMediaResource,
  shutdownUpnpMedia,
} from "./media";

test("UPnP media listener serves immutable file bytes with HEAD and single Range", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-upnp-media-"));
  const filePath = path.join(dir, "fixture.flac");
  const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
  await writeFile(filePath, bytes);

  const resource = await registerMediaFile(filePath, {
    rendererHost: "127.0.0.1",
    title: "Fixture",
    durationMs: 1234,
  });
  try {
    const full = await fetch(resource.url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-type"), "audio/flac");
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);

    const head = await fetch(resource.url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get("content-length")), bytes.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const range = await fetch(resource.url, { headers: { Range: "bytes=5-12" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 5-12/${bytes.length}`);
    assert.equal(await range.text(), bytes.subarray(5, 13).toString());

    const suffix = await fetch(resource.url, { headers: { Range: "bytes=-4" } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), bytes.subarray(-4).toString());

    const invalid = await fetch(resource.url, { headers: { Range: "bytes=999-1000" } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), `bytes */${bytes.length}`);

    const multi = await fetch(resource.url, { headers: { Range: "bytes=0-1,4-5" } });
    assert.equal(multi.status, 200);
    assert.deepEqual(Buffer.from(await multi.arrayBuffer()), bytes);
  } finally {
    await releaseMediaResource(resource);
    await shutdownUpnpMedia();
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "aborted Renderer request closes the media file descriptor",
  { skip: process.platform !== "linux" },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-upnp-abort-"));
    const filePath = path.join(dir, "fixture.dsf");
    await writeFile(filePath, Buffer.alloc(8 * 1024 * 1024, 0x96));
    const resource = await registerMediaFile(filePath, {
      rendererHost: "127.0.0.1",
      title: "Abort fixture",
    });

    const countOpenHandles = async (): Promise<number> => {
      const names = await readdir("/proc/self/fd");
      let count = 0;
      for (const name of names) {
        try {
          const target = (await readlink(`/proc/self/fd/${name}`)).replace(/ \(deleted\)$/, "");
          if (target === filePath) count += 1;
        } catch {}
      }
      return count;
    };

    try {
      await new Promise<void>((resolve) => {
        const request = http.get(resource.url, (response) => {
          response.once("data", () => {
            response.destroy();
            resolve();
          });
          response.once("error", () => resolve());
        });
        request.once("error", () => resolve());
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await countOpenHandles(), 0);
    } finally {
      await releaseMediaResource(resource);
      await shutdownUpnpMedia();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("inferUpnpMime keeps real container MIME and recovers cache MIME from codec", () => {
  assert.equal(inferUpnpMime("/music/track.dsdiff", "unknown"), "audio/x-dff");
  assert.equal(inferUpnpMime("/cache/abcd.bin", "flac"), "audio/flac");
  assert.equal(inferUpnpMime("/tmp/input.audio", "dsd_dsf"), "audio/x-dsf");
  assert.equal(inferUpnpMime("/tmp/fragment.mp4", "flac"), "audio/mp4");
  assert.equal(inferUpnpMime("/cache/unknown.bin", "unknown"), "application/octet-stream");
});

test("release deletes generated media only when ownership is explicit", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-upnp-release-"));
  const generated = path.join(dir, "generated.wav");
  const borrowed = path.join(dir, "borrowed.wav");
  await writeFile(generated, Buffer.from("generated"));
  await writeFile(borrowed, Buffer.from("borrowed"));
  const owned = await registerMediaFile(generated, {
    rendererHost: "127.0.0.1",
    title: "Generated",
    deleteOnRelease: true,
  });
  const external = await registerMediaFile(borrowed, {
    rendererHost: "127.0.0.1",
    title: "Borrowed",
  });
  try {
    await releaseMediaResource(owned);
    await assert.rejects(access(generated));
    await access(borrowed);
    await releaseMediaResource(external);
    await access(borrowed);
    const closed = await fetch(external.url).then(
      () => false,
      () => true,
    );
    assert.equal(closed, true);
  } finally {
    await shutdownUpnpMedia();
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepared-media cleanup never deletes borrowed local files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "splayer-atom-upnp-prepared-"));
  const borrowed = path.join(dir, "borrowed.flac");
  await writeFile(borrowed, Buffer.from("borrowed"));
  try {
    await discardPreparedUpnpMedia({
      filePath: borrowed,
      durationMs: 1000,
      mime: "audio/flac",
      deleteOnRelease: false,
    });
    await access(borrowed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
