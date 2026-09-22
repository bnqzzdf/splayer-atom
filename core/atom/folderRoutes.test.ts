import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("Folder HTTP routes keep material streaming and path authorization inside library roots", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-folder-routes-data-"));
  const root = mkdtempSync(path.join(tmpdir(), "splayer-folder-routes-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "splayer-folder-routes-outside-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const pdf = path.join(root, "Booklet.pdf");
  const textFile = path.join(root, "Rip.log");
  const outsidePdf = path.join(outside, "secret.pdf");
  const albumDir = path.join(root, "Album");
  const emptyDir = path.join(root, "Empty");
  const outsideLink = path.join(root, "Outside Link");
  mkdirSync(albumDir);
  mkdirSync(emptyDir);
  symlinkSync(outside, outsideLink, "dir");
  writeFileSync(pdf, "%PDF-1.7\n0123456789");
  writeFileSync(textFile, "Exact Audio Copy\nOK\n");
  writeFileSync(outsidePdf, "%PDF-1.7\noutside");
  writeFileSync(
    path.join(albumDir, "Folder.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  const database = await import("@main/database");
  const { store } = await import("@main/store");
  const { buildFolderRoutes } = await import("./folderRoutes");

  try {
    database.initDatabase();
    store.set("library.scanDirs", [root]);
    store.set("library.pinnedFolders", []);
    const app = buildFolderRoutes();

    const rootsResponse = await app.request("http://folder.test/library/folders/roots");
    assert.equal(rootsResponse.status, 200);
    const roots = (await rootsResponse.json()) as {
      roots: Array<{ path: string; available: boolean }>;
    };
    assert.equal(roots.roots[0]?.path, root);
    assert.equal(roots.roots[0]?.available, true);

    const browseResponse = await app.request(
      `http://folder.test/library/folders/browse?path=${encodeURIComponent(root)}`,
    );
    assert.equal(browseResponse.status, 200);
    const browse = (await browseResponse.json()) as {
      entries: Array<{ kind: string; path: string }>;
    };
    assert.ok(browse.entries.some((entry) => entry.kind === "material" && entry.path === pdf));
    assert.ok(browse.entries.some((entry) => entry.kind === "material" && entry.path === textFile));

    const filteredBrowseResponse = await app.request(
      `http://folder.test/library/folders/browse?path=${encodeURIComponent(root)}&filter=booklet`,
    );
    assert.equal(filteredBrowseResponse.status, 200);
    const filteredBrowse = (await filteredBrowseResponse.json()) as {
      entries: Array<{ path: string }>;
    };
    assert.deepEqual(filteredBrowse.entries.map((entry) => entry.path), [pdf]);

    const emptyDirectoryThumb = await app.request(
      `http://folder.test/library/folders/directory/thumbnail?path=${encodeURIComponent(emptyDir)}`,
    );
    assert.equal(emptyDirectoryThumb.status, 404);

    const outsideDirectoryThumb = await app.request(
      `http://folder.test/library/folders/directory/thumbnail?path=${encodeURIComponent(outside)}`,
    );
    assert.equal(outsideDirectoryThumb.status, 403);

    const escapedBrowse = await app.request(
      `http://folder.test/library/folders/browse?path=${encodeURIComponent(outsideLink)}`,
    );
    assert.equal(escapedBrowse.status, 403);

    const escapedScan = await app.request("http://folder.test/library/folders/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: outsideLink, incremental: true }),
    });
    assert.equal(escapedScan.status, 403);

    const rangeResponse = await app.request(
      `http://folder.test/library/folders/material?path=${encodeURIComponent(pdf)}`,
      { headers: { Range: "bytes=0-3" } },
    );
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(rangeResponse.headers.get("content-range"), "bytes 0-3/19");
    assert.equal(await rangeResponse.text(), "%PDF");

    const invalidRange = await app.request(
      `http://folder.test/library/folders/material?path=${encodeURIComponent(pdf)}`,
      { headers: { Range: "bytes=999-1000" } },
    );
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), "bytes */19");

    const textResponse = await app.request(
      `http://folder.test/library/folders/material/text?path=${encodeURIComponent(textFile)}`,
    );
    assert.equal(textResponse.status, 200);
    const textBody = (await textResponse.json()) as { text: string; truncated: boolean };
    assert.match(textBody.text, /Exact Audio Copy/);
    assert.equal(textBody.truncated, false);

    const outsideResponse = await app.request(
      `http://folder.test/library/folders/material?path=${encodeURIComponent(outsidePdf)}`,
    );
    assert.equal(outsideResponse.status, 403);

    const locationResponse = await app.request("http://folder.test/library/folders/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track: {
          id: "local-file",
          source: "local",
          path: path.join(root, "track.flac"),
          title: "Track",
          artists: [],
          duration: 0,
        },
      }),
    });
    assert.equal(locationResponse.status, 200);
    const location = (await locationResponse.json()) as { path: string; focusPath: string };
    assert.equal(location.path, root);
    assert.equal(location.focusPath, path.join(root, "track.flac"));
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
