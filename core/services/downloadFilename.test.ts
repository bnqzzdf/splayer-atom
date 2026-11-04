import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DownloadRequest, DownloadTask } from "@shared/types/download";

test("Core download honors Content-Disposition on extensionless URLs, even with skip policy", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "splayer-download-extension-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = path.join(temp, "data");
  const downloadDir = path.join(temp, "downloads");
  const body = Buffer.from("fLaC-test-payload");
  let served = 0;
  const server = createServer((_request, response) => {
    served++;
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''album%20track.FLAC",
      "Content-Length": String(body.length),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const database = await import("@main/database");
  const { store } = await import("@main/store");
  const downloads = await import("./downloadManager");
  try {
    database.initDatabase();
    store.set("cache.dir", path.join(temp, "cache"));
    store.set("download.dir", downloadDir);
    store.set("download.folderScheme", "none");
    store.set("download.fileTemplate", "{title}");
    store.set("download.overwritePolicy", "skip");
    await downloads.init();
    const oldName = path.join(downloadDir, "Example.mp3");
    // A former fallback .mp3 must not trigger pre-flight skip of a real FLAC.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(downloadDir, { recursive: true });
    writeFileSync(oldName, "existing mp3");
    const req: DownloadRequest = {
      destination: "core",
      taskId: crypto.randomUUID(),
      track: {
        id: "download-extension-test",
        source: "netease",
        title: "Example",
        artists: [],
        duration: 1000,
      },
      qualityLevel: "lossless",
      url: `http://127.0.0.1:${address.port}/without-extension`,
      usePlaybackForDownload: false,
      tagOptions: {
        embedCover: false,
        embedMeta: false,
        embedLyric: false,
        writeLrc: true,
        saveTtml: false,
      },
      lyricText: "[00:00.00] test",
      lyricFileFormat: "lrc",
    };
    assert.deepEqual(downloads.enqueue(req), { ok: true });
    let task: DownloadTask | undefined;
    for (let retry = 0; retry < 150; retry++) {
      task = downloads.list().find((item) => item.taskId === req.taskId);
      if (task?.status === "done" || task?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(task?.status, "done", `task failure: ${task?.errorCode}`);
    const expected = path.join(downloadDir, "Example.flac");
    assert.equal(task.filePath, expected);
    assert.deepEqual(readFileSync(expected), body);
    assert.equal(readFileSync(oldName, "utf8"), "existing mp3");
    assert.equal(readFileSync(path.join(downloadDir, "Example.lrc"), "utf8"), req.lyricText);
    assert.equal(served, 1);
    assert.equal(
      existsSync(path.join(temp, "cache", "downloads-tmp", `${req.taskId}.part`)),
      false,
    );
  } finally {
    downloads.shutdown();
    database.closeDatabase();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(temp, { recursive: true, force: true });
  }
});
