import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("Folder media allowlist stays locked to the native scanner allowlist", async () => {
  const nativeSource = readFileSync(
    path.resolve(process.cwd(), "native/audio-engine-core/src/scanner.rs"),
    "utf8",
  );
  const folderSource = readFileSync(
    path.resolve(process.cwd(), "core/services/folderBrowser.ts"),
    "utf8",
  );
  const nativeMatch = nativeSource.match(/const AUDIO_EXTENSIONS: &\[&str\] = &\[(.*?)\];/s);
  const folderMatch = folderSource.match(
    /const ORDINARY_AUDIO_EXTENSIONS = new Set\(\[(.*?)\]\);/s,
  );
  assert.ok(nativeMatch, "native scanner extension list must remain discoverable");
  assert.ok(folderMatch, "Folder ordinary-audio extension list must remain discoverable");
  const nativeExtensions = [...nativeMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
  const folderExtensions = [...folderMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  folderExtensions.push("iso", "cue");
  assert.deepEqual(folderExtensions.sort(), nativeExtensions);
});

test("Folder Browser browses live media/materials without a completed scan", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-folder-browser-data-"));
  const root = mkdtempSync(path.join(tmpdir(), "splayer-folder-browser-root-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "splayer-folder-browser-outside-"));
  const aliasParent = mkdtempSync(path.join(tmpdir(), "splayer-folder-browser-alias-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;

  const subfolder = path.join(root, "A very long album folder name");
  mkdirSync(subfolder);
  const subfolderCover = path.join(subfolder, "Cover.png");
  const indexed = path.join(root, "01 Indexed.flac");
  const loose = path.join(root, "02 Loose.flac");
  const whole = path.join(root, "whole.flac");
  const invalidBacking = path.join(root, "bad.flac");
  const cue = path.join(root, "album.cue");
  const invalidCue = path.join(root, "bad.cue");
  const log = path.join(root, "EAC.log");
  const westernLog = path.join(root, "Western.log");
  const pdf = path.join(root, "Booklet.pdf");
  const cover = path.join(root, "Cover.jpg");
  const hugeLog = path.join(root, "Huge.log");
  const disguisedPdf = path.join(root, "NotReally.pdf");
  const binaryLog = path.join(root, "Binary.log");
  const unsupported = path.join(root, "archive.zip");
  const cueActionDir = path.join(root, "Cue Action");
  mkdirSync(cueActionDir);
  const cueActionBacking = path.join(cueActionDir, "whole.flac");
  const cueActionCue = path.join(cueActionDir, "album.cue");
  const ordering = path.join(root, "ordering");
  const canonicalArtworkDir = path.join(root, "Canonical Artwork");
  const orderingCd1 = path.join(ordering, "CD1");
  const orderingCd2 = path.join(ordering, "CD2");
  mkdirSync(orderingCd1, { recursive: true });
  mkdirSync(orderingCd2, { recursive: true });
  mkdirSync(canonicalArtworkDir);
  const canonicalArtworkTrack = path.join(canonicalArtworkDir, "01.flac");
  const cacheDir = path.join(dataDir, "cache");
  const cachedCanonicalCover = path.join(cacheDir, "covers", "canonical.jpg");
  mkdirSync(path.dirname(cachedCanonicalCover), { recursive: true });
  writeFileSync(cachedCanonicalCover, "cached-cover");
  const ordering02 = path.join(ordering, "02.flac");
  const ordering10 = path.join(ordering, "10.flac");
  const orderingCd1Track = path.join(orderingCd1, "01.flac");
  const orderingCd2Track = path.join(orderingCd2, "01.flac");
  const outsideTrack = path.join(outsideRoot, "outside.flac");
  const outsideLog = path.join(outsideRoot, "Outside.log");
  const outsideDirectoryLink = path.join(root, "External Link");
  const outsideFileLink = path.join(root, "External.log");
  const rootAlias = path.join(aliasParent, "music");

  writeFileSync(indexed, "not-a-real-flac");
  writeFileSync(
    subfolderCover,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  writeFileSync(loose, "not-a-real-flac");
  writeFileSync(whole, "not-a-real-flac");
  writeFileSync(invalidBacking, "not-a-real-flac");
  writeFileSync(
    cue,
    [
      'FILE "whole.flac" WAVE',
      "  TRACK 01 AUDIO",
      "    INDEX 01 00:00:00",
      "  TRACK 02 AUDIO",
      "    INDEX 01 01:00:00",
    ].join("\n"),
  );
  writeFileSync(invalidCue, ['FILE "bad.flac" WAVE', "  TRACK 01 AUDIO"].join("\n"));
  writeFileSync(log, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]));
  writeFileSync(westernLog, Buffer.from([0x42, 0x65, 0x79, 0x6f, 0x6e, 0x63, 0xe9, 0x0a]));
  writeFileSync(pdf, "%PDF-1.7\n");
  writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(hugeLog, Buffer.alloc(1024 * 1024 + 64, 0x61));
  writeFileSync(disguisedPdf, "this is not a PDF");
  writeFileSync(binaryLog, Buffer.from([0x00, 0x01, 0x02, 0x03]));
  writeFileSync(unsupported, "zip");
  writeFileSync(cueActionBacking, "not-a-real-flac");
  writeFileSync(
    cueActionCue,
    [
      'FILE "whole.flac" WAVE',
      "  TRACK 01 AUDIO",
      "    INDEX 01 00:00:00",
      "  TRACK 02 AUDIO",
      "    INDEX 01 01:00:00",
    ].join("\n"),
  );
  writeFileSync(ordering02, "02");
  writeFileSync(ordering10, "10");
  writeFileSync(orderingCd1Track, "cd1");
  writeFileSync(orderingCd2Track, "cd2");
  writeFileSync(canonicalArtworkTrack, "canonical");
  writeFileSync(outsideTrack, "outside");
  writeFileSync(outsideLog, "outside");
  symlinkSync(ordering, path.join(orderingCd2, "back-to-ordering"), "dir");
  symlinkSync(outsideRoot, outsideDirectoryLink, "dir");
  symlinkSync(outsideLog, outsideFileLink, "file");
  symlinkSync(root, rootAlias, "dir");

  const database = await import("@main/database");
  const { store } = await import("@main/store");
  const folder = await import("./folderBrowser");
  const { resolvePlaybackSource } = await import("./playbackSourceResolver");

  try {
    database.initDatabase();
    store.set("library.scanDirs", [root]);
    store.set("library.pinnedFolders", []);
    store.set("cache.dir", cacheDir);
    const indexedStat = statSync(indexed);
    const canonicalArtworkStat = statSync(canonicalArtworkTrack);
    const cueActionStat = statSync(cueActionCue);
    const cueActionBackingStat = statSync(cueActionBacking);
    database.upsertTracks([
      {
        id: "indexed-track",
        path: indexed,
        title: "Indexed title",
        artists: [{ name: "Artist" }],
        duration: 1000,
        fileSize: indexedStat.size,
        mtime: indexedStat.mtimeMs,
        ctime: indexedStat.ctimeMs,
      },
      {
        id: "cue-track-1",
        path: `cue://${cueActionCue}#track=01`,
        cuePath: cueActionCue,
        cueAudioPath: cueActionBacking,
        cueStartMs: 0,
        cueEndMs: 60_000,
        title: "Cue 1",
        track: 1,
        artists: [],
        duration: 60_000,
        fileSize: cueActionBackingStat.size,
        mtime: cueActionStat.mtimeMs,
        ctime: cueActionStat.ctimeMs,
      },
      {
        id: "cue-track-2",
        path: `cue://${cueActionCue}#track=02`,
        cuePath: cueActionCue,
        cueAudioPath: cueActionBacking,
        cueStartMs: 60_000,
        title: "Cue 2",
        track: 2,
        artists: [],
        duration: 60_000,
        fileSize: cueActionBackingStat.size,
        mtime: cueActionStat.mtimeMs,
        ctime: cueActionStat.ctimeMs,
      },
      {
        id: "canonical-artwork-track",
        path: canonicalArtworkTrack,
        title: "Canonical Artwork",
        artists: [],
        duration: 1000,
        cover: "cache://covers/canonical.jpg",
        fileSize: canonicalArtworkStat.size,
        mtime: canonicalArtworkStat.mtimeMs,
        ctime: canonicalArtworkStat.ctimeMs,
      },
    ]);

    const page = await folder.browseFolder(root, undefined, 100);
    assert.equal(page.unavailable, false);
    assert.equal(page.root, path.resolve(root));
    assert.equal(page.parent, null);
    assert.ok(page.entries.some((entry) => entry.kind === "directory" && entry.path === subfolder));
    assert.equal(
      page.entries.some(
        (entry) => entry.path === outsideDirectoryLink || entry.path === outsideFileLink,
      ),
      false,
      "browse must not expose symlinks whose real target escapes the configured root",
    );
    assert.equal(await folder.resolveFolderDirectoryArtworkPath(subfolder), subfolderCover);
    assert.equal(
      await folder.resolveFolderDirectoryArtworkPath(canonicalArtworkDir),
      cachedCanonicalCover,
      "grid artwork may reuse one reliable canonical local cover without probing media",
    );
    assert.ok(
      page.entries.some(
        (entry) =>
          entry.kind === "track" && entry.path === indexed && entry.track.title === "Indexed title",
      ),
    );
    assert.ok(page.entries.some((entry) => entry.kind === "file" && entry.path === loose));
    assert.ok(
      page.entries.some(
        (entry) => entry.kind === "cue" && entry.path === cue && entry.trackCount === 2,
      ),
    );
    assert.equal(
      page.entries.some((entry) => entry.path === whole),
      false,
      "valid CUE must hide its whole-file backing audio",
    );
    assert.ok(page.entries.some((entry) => entry.kind === "cue" && entry.path === invalidCue));
    assert.ok(
      page.entries.some((entry) => entry.kind === "file" && entry.path === invalidBacking),
      "invalid CUE must not hide otherwise playable audio",
    );
    assert.ok(
      page.entries.some(
        (entry) => entry.kind === "material" && entry.path === log && entry.materialType === "text",
      ),
    );
    assert.ok(
      page.entries.some(
        (entry) => entry.kind === "material" && entry.path === pdf && entry.materialType === "pdf",
      ),
    );
    assert.ok(
      page.entries.some(
        (entry) =>
          entry.kind === "material" && entry.path === cover && entry.materialType === "image",
      ),
    );
    assert.equal(
      page.entries.some((entry) => entry.path === disguisedPdf),
      false,
    );
    assert.equal(
      page.entries.some((entry) => entry.path === binaryLog),
      false,
    );
    assert.equal(
      page.entries.some((entry) => entry.path === unsupported),
      false,
    );

    const decoded = await folder.readFolderTextMaterial(log);
    assert.equal(decoded.text.trim(), "中文");
    assert.equal(decoded.truncated, false);
    const western = await folder.readFolderTextMaterial(westernLog);
    assert.equal(western.text.trim(), "Beyoncé");
    const huge = await folder.readFolderTextMaterial(hugeLog);
    assert.equal(huge.truncated, true);
    assert.equal(Buffer.byteLength(huge.text, "utf8"), 1024 * 1024);

    const cueActionPlayback = await folder.resolveFolderPlaybackTracks(cueActionDir, false);
    assert.ok(cueActionPlayback.tracks.some((track) => track.id === "cue-track-1"));
    assert.ok(cueActionPlayback.tracks.some((track) => track.id === "cue-track-2"));
    assert.equal(
      cueActionPlayback.tracks.some((track) => track.path === cueActionBacking),
      false,
      "Folder actions must not enqueue a CUE backing file beside its virtual tracks",
    );
    const playlists = await import("@main/database/playlists");
    const singleTrackPlaylist = playlists.createPlaylist({
      type: "local",
      title: "Single virtual track",
    });
    const addSingleTrack = await folder.addContainerTrackToPlaylist(
      singleTrackPlaylist.id,
      cueActionCue,
      "cue-track-2",
    );
    assert.equal(addSingleTrack.added, 1);
    assert.deepEqual(
      playlists.getPlaylist(singleTrackPlaylist.id)?.tracks.map((track) => track.id),
      ["cue-track-2"],
      "Folder container track playlist action must canonicalize and add only the selected split",
    );
    const batchPlaylist = playlists.createPlaylist({
      type: "local",
      title: "Folder batch",
    });
    const addBatch = await folder.addFolderBatchToPlaylist(batchPlaylist.id, [
      { kind: "path", path: indexed },
      { kind: "container-track", containerPath: cueActionCue, trackId: "cue-track-2" },
      { kind: "path", path: indexed },
    ]);
    assert.equal(addBatch.added, 2);
    assert.deepEqual(
      playlists.getPlaylist(batchPlaylist.id)?.tracks.map((track) => track.id),
      ["indexed-track", "cue-track-2"],
      "Folder batch playlist actions preserve explicit selection order and deduplicate tracks",
    );

    const first = await folder.browseFolder(root, undefined, 2);
    assert.equal(first.entries.length, 2);
    assert.ok(first.nextCursor);
    const second = await folder.browseFolder(root, first.nextCursor, 2);
    assert.equal(second.entries.length, 2);
    assert.notDeepEqual(
      first.entries.map((entry) => entry.path),
      second.entries.map((entry) => entry.path),
    );
    const focused = await folder.browseFolder(root, undefined, 2, log);
    assert.ok(focused.entries.some((entry) => entry.path === log));
    assert.ok(focused.previousCursor, "focus paging must still allow browsing earlier entries");

    const staleCursor = first.nextCursor!;
    writeFileSync(path.join(root, "03 Added Later.flac"), "new");
    await assert.rejects(
      () => folder.browseFolder(root, staleCursor, 2),
      /FOLDER_CURSOR_STALE/,
      "filesystem mutation must invalidate an old directory cursor",
    );

    const search = await folder.searchFolders("very long");
    assert.ok(search.data.some((entry) => entry.kind === "directory" && entry.path === subfolder));
    const escapedSearch = await folder.searchFolders("external");
    assert.equal(
      escapedSearch.data.some(
        (entry) => entry.path === outsideDirectoryLink || entry.path === outsideFileLink,
      ),
      false,
      "Folder Search must not traverse or expose out-of-root symlink targets",
    );
    await assert.rejects(
      () => folder.resolveFolderPlaybackTracks(outsideDirectoryLink, true),
      /FOLDER_PATH_OUTSIDE_LIBRARY_ROOT/,
    );
    await assert.rejects(
      () => folder.pinFolder(outsideDirectoryLink),
      /FOLDER_PATH_OUTSIDE_LIBRARY_ROOT/,
    );
    await assert.rejects(
      () => folder.readFolderTextMaterial(outsideFileLink),
      /FOLDER_PATH_OUTSIDE_LIBRARY_ROOT/,
    );

    const currentOnly = await folder.resolveFolderPlaybackTracks(ordering, false);
    assert.deepEqual(
      currentOnly.tracks.map((track) => track.path),
      [ordering02, ordering10],
      "current-folder-only actions must not traverse child directories",
    );
    assert.deepEqual(await resolvePlaybackSource(currentOnly.tracks[0]!), {
      source: ordering02,
      provider: "local",
    });
    const recursive = await folder.resolveFolderPlaybackTracks(ordering, true);
    assert.deepEqual(
      recursive.tracks.map((track) => track.path),
      [ordering02, ordering10, orderingCd1Track, orderingCd2Track],
      "recursive actions must use deterministic natural directory/file order and stop symlink cycles",
    );

    const massive = path.join(root, "Massive");
    mkdirSync(massive);
    for (let index = 1; index <= 600; index++) {
      writeFileSync(
        path.join(massive, "mass-item-" + String(index).padStart(4, "0") + ".flac"),
        "",
      );
    }
    const massivePage = await folder.browseFolder(massive, undefined, 999);
    assert.equal(massivePage.counts.media, 600);
    assert.equal(massivePage.entries.length, 500, "browse transport must enforce its page cap");
    assert.ok(massivePage.nextCursor);
    const massiveSecond = await folder.browseFolder(massive, massivePage.nextCursor, 500);
    assert.equal(massiveSecond.entries.length, 100);
    assert.ok(massiveSecond.previousCursor);
    const focusTarget = path.join(massive, "mass-item-0551.flac");
    const massiveFocused = await folder.browseFolder(massive, undefined, 200, focusTarget);
    assert.ok(massiveFocused.entries.some((entry) => entry.path === focusTarget));
    assert.ok(massiveFocused.previousCursor);
    const filteredMassive = await folder.browseFolder(massive, undefined, 20, undefined, "0551");
    assert.equal(filteredMassive.counts.media, 1);
    assert.deepEqual(
      filteredMassive.entries.map((entry) => entry.path),
      [focusTarget],
      "current-folder filter must match entries beyond the first unfiltered browse page",
    );
    await assert.rejects(
      () => folder.browseFolder(massive, massivePage.nextCursor, 20, undefined, "0551"),
      /FOLDER_CURSOR_INVALID/,
      "browse cursor must stay bound to the filter that created it",
    );
    const searchPageOne = await folder.searchFolders("mass-item", undefined, 100);
    assert.equal(searchPageOne.data.length, 100);
    assert.ok(searchPageOne.nextCursor);
    const searchPageTwo = await folder.searchFolders("mass-item", searchPageOne.nextCursor, 100);
    assert.equal(searchPageTwo.data.length, 100);
    assert.equal(
      searchPageTwo.data.some((entry) =>
        searchPageOne.data.some((firstEntry) => firstEntry.path === entry.path),
      ),
      false,
      "Folder Search pages must not repeat previous results",
    );

    await folder.pinFolder(subfolder);
    const pins = await folder.listPinnedFolders();
    assert.equal(pins.length, 1);
    assert.equal(pins[0]?.path, subfolder);
    assert.equal(pins[0]?.available, true);
    rmSync(subfolder, { recursive: true, force: true });
    assert.equal(
      (await folder.listPinnedFolders())[0]?.available,
      false,
      "temporarily missing pinned folders remain visible as unavailable",
    );
    await folder.unpinFolder(subfolder);
    assert.equal((await folder.listPinnedFolders()).length, 0);

    writeFileSync(indexed, "changed-after-index");
    const changedPage = await folder.browseFolder(root, undefined, 100);
    assert.ok(
      changedPage.entries.some((entry) => entry.kind === "file" && entry.path === indexed),
      "a changed physical file must not project stale canonical metadata as current",
    );

    assert.throws(
      () => folder.resolveFolderPath(path.dirname(root)),
      /FOLDER_PATH_OUTSIDE_LIBRARY_ROOT/,
    );
    assert.throws(
      () =>
        folder.resolveTrackFolderLocation({
          id: "outside",
          source: "local",
          path: path.join(path.dirname(root), "outside.flac"),
          title: "outside",
          artists: [],
          duration: 0,
        }),
      /FOLDER_PATH_OUTSIDE_LIBRARY_ROOT/,
    );

    const cueLocation = folder.resolveTrackFolderLocation({
      id: "cue-track",
      source: "local",
      path: `cue://${cue}#track=01`,
      cuePath: cue,
      cueAudioPath: whole,
      title: "Cue",
      artists: [],
      duration: 0,
    });
    assert.deepEqual(cueLocation, {
      path: root,
      containerPath: cue,
      focusTrackId: "cue-track",
    });
    const iso = path.join(root, "disc.iso");
    const sacdLocation = folder.resolveTrackFolderLocation({
      id: "sacd-track",
      source: "local",
      path: `${iso}|Track01|2ch|2822400`,
      title: "SACD",
      artists: [],
      duration: 0,
    });
    assert.deepEqual(sacdLocation, {
      path: root,
      containerPath: iso,
      focusTrackId: "sacd-track",
    });

    const duplicateRootA = path.join(root, "Root A", "music");
    const duplicateRootB = path.join(root, "Root B", "music");
    mkdirSync(duplicateRootA, { recursive: true });
    mkdirSync(duplicateRootB, { recursive: true });
    store.set("library.scanDirs", [duplicateRootA, duplicateRootB]);
    const duplicateRoots = await folder.listFolderRoots();
    assert.deepEqual(
      duplicateRoots.map((item) => item.name),
      ["music", "music"],
      "duplicate basenames remain separate roots rather than being merged by display name",
    );
    assert.notEqual(duplicateRoots[0]?.path, duplicateRoots[1]?.path);

    store.set("library.scanDirs", [rootAlias]);
    const aliasPage = await folder.browseFolder(rootAlias, undefined, 20);
    assert.equal(aliasPage.unavailable, false);
    assert.ok(
      aliasPage.entries.some((entry) => entry.path === path.join(rootAlias, "02 Loose.flac")),
      "configured root itself may be a symlink while staying the logical Folder identity",
    );

    const offlineRoot = path.join(root, "Offline root");
    store.set("library.scanDirs", [offlineRoot]);
    const offlineRoots = await folder.listFolderRoots();
    assert.equal(offlineRoots[0]?.path, offlineRoot);
    assert.equal(offlineRoots[0]?.available, false);
    assert.deepEqual(
      folder.resolveTrackFolderLocation({
        id: "offline-track",
        source: "local",
        path: path.join(offlineRoot, "album", "track.flac"),
        title: "Offline",
        artists: [],
        duration: 0,
      }),
      {
        path: path.join(offlineRoot, "album"),
        focusTrackId: "offline-track",
        focusPath: path.join(offlineRoot, "album", "track.flac"),
      },
      "open-containing-folder keeps a stable location even while the configured root is offline",
    );

    store.set("library.scanDirs", [root]);
    const missing = path.join(root, "temporarily-offline");
    const unavailable = await folder.browseFolder(missing);
    assert.equal(unavailable.unavailable, true);
    assert.deepEqual(unavailable.entries, []);
  } finally {
    database.closeDatabase();
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
    rmSync(aliasParent, { recursive: true, force: true });
  }
});
