import assert from "node:assert/strict";
import test from "node:test";

import { renderDownloadPath, truncateFilename } from "./filename";

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
});
