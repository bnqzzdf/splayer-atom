import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  dedupePath,
  extensionFromDisposition,
  renderDownloadPath,
  resolveExtension,
  truncateFilename,
} from "./filename";

test("下载文件名包含碟号、曲目号和完整作品标题", () => {
  assert.deepEqual(
    renderDownloadPath("album", "{title}", {
      artist: "Heinrich Schiff / Hagen Quartett",
      albumArtist: "Heinrich Schiff / Hagen Quartett",
      album: "Schubert String Quintet",
      title: "Schubert String Quintet in C, D.956 - Allegro ma non troppo",
      disc: 1,
      track: 1,
    }),
    {
      relDir: "Heinrich Schiff Hagen Quartett/Schubert String Quintet",
      baseName: "01-01 Schubert String Quintet in C, D.956 - Allegro ma non troppo",
    },
  );
  assert.equal(
    renderDownloadPath("album-disc", "{title}", {
      artist: "Composer",
      albumArtist: "Composer",
      album: "Complete Works",
      title: "Work - Adagio",
      disc: 2,
      track: 3,
    }).relDir,
    "Composer/Complete Works/CD 2",
  );
});

test("超长 UTF-8 文件名保留扩展名并按字节安全截断", () => {
  const name = truncateFilename(`01 ${"作品".repeat(200)}`, ".flac");
  assert.ok(Buffer.byteLength(`${name}.flac`, "utf8") <= 255);
  assert.equal(name.includes("�"), false);
  const emojiName = truncateFilename("🎵".repeat(200), ".flac");
  assert.ok(Buffer.byteLength(`${emojiName}.flac`, "utf8") <= 255);
  assert.equal(emojiName.includes("�"), false);
});

test("超长重名文件仍能生成带序号且不超长的路径", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "splayer-filename-"));
  try {
    const baseName = "a".repeat(250);
    const first = path.join(directory, `${truncateFilename(baseName, ".flac")}.flac`);
    writeFileSync(first, "existing");
    const renamed = dedupePath(path.join(directory, truncateFilename(baseName, ".flac")), ".flac");
    assert.notEqual(renamed, first);
    assert.ok(Buffer.byteLength(path.basename(renamed), "utf8") <= 255);
    assert.match(renamed, / \(2\)\.flac$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("响应文件名只提取合法的音频扩展名，优先解析 UTF-8 filename*", () => {
  assert.equal(extensionFromDisposition('attachment; filename="CD1.FLAC"'), ".flac");
  assert.equal(extensionFromDisposition("attachment; filename=track.APE"), ".ape");
  assert.equal(
    extensionFromDisposition(
      "attachment; filename=wrong.mp3; filename*=UTF-8''%E6%B5%8B%E8%AF%95.WAV",
    ),
    ".wav",
  );
  assert.equal(extensionFromDisposition('attachment; filename="Part; 1.aiff"'), ".aiff");
  assert.equal(extensionFromDisposition('attachment; filename="track.pdf"'), undefined);
  assert.equal(extensionFromDisposition('attachment; filename="track.flac.exe"'), undefined);
  assert.equal(extensionFromDisposition('attachment; creation-date="track.flac"'), undefined);
  assert.equal(
    extensionFromDisposition("attachment; filename*=UTF-8''broken%XX; filename=ok.ogg"),
    ".ogg",
  );
  assert.equal(extensionFromDisposition(null), undefined);
});

test("扩展名优先级为有效声明、响应文件名、MIME、URL 和默认值", () => {
  const url = "https://cdn.example/audio/no-extension?token=abc";
  const disposition = 'attachment; filename="actual.flac"';
  assert.equal(resolveExtension("wav", "audio/mpeg", url, disposition), ".wav");
  assert.equal(resolveExtension("invalid", "audio/mpeg", url, disposition), ".flac");
  assert.equal(resolveExtension(undefined, "application/octet-stream", url, disposition), ".flac");
  assert.equal(
    resolveExtension(undefined, "audio/mpeg", url, 'attachment; filename="bad.bin"'),
    ".mp3",
  );
  assert.equal(
    resolveExtension(undefined, "application/octet-stream", "https://cdn.example/file.WV?x=1"),
    ".wv",
  );
  assert.equal(resolveExtension(undefined, "application/octet-stream", url), ".mp3");
  assert.equal(resolveExtension(undefined, null, url, null, ""), "");
  assert.equal(resolveExtension(undefined, null, "https://cdn.example/a.mp3", null, ""), ".mp3");
});
