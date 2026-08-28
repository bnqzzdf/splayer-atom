/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configPath = fileURLToPath(new URL("./upstream.json", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const args = process.argv.slice(2);
const command = args[0] || "status";
const commandArgs = args.slice(1);

const runGit = (gitArgs, { allowFailure = false, cwd = process.cwd() } = {}) => {
  const result = spawnSync("git", gitArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new Error(`git ${gitArgs.join(" ")}\n${detail}`);
  }

  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
  };
};

const git = (gitArgs, options) => runGit(gitArgs, options).stdout;
const gitOk = (gitArgs) => runGit(gitArgs, { allowFailure: true }).ok;

const getOption = (name) => {
  const index = commandArgs.indexOf(name);
  if (index === -1) return null;
  const value = commandArgs[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
};

const hasOption = (name) => commandArgs.includes(name);

const normalizeRepositoryUrl = (url) => {
  if (!url) return "";
  const trimmed = url.trim().replace(/\.git$/, "");
  const sshMatch = /^git@github\.com:(.+)$/.exec(trimmed);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  return trimmed.replace(/^git:\/\/github\.com\//, "https://github.com/");
};

const upstreamRepository = normalizeRepositoryUrl(config.repository);
const sourceRef = `${config.remote}/${config.sourceBranch}`;

const remoteExists = (name) => gitOk(["remote", "get-url", name]);
const remoteUrl = (name) => git(["remote", "get-url", name]);
const pushRemoteUrl = (name) => git(["remote", "get-url", "--push", name]);
const refExists = (ref) => gitOk(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
const resolveCommit = (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]);
const branchExists = (branch) => gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
const isAncestor = (ancestor, descendant) =>
  gitOk(["merge-base", "--is-ancestor", ancestor, descendant]);

const branchRemote = (branch) =>
  runGit(["config", "--get", `branch.${branch}.remote`], { allowFailure: true }).stdout;

const printPair = (label, value) => console.log(`${label}: ${value}`);

const verifyState = ({ vendorRef = config.vendorBranch, ci = false, headRef = "dev" } = {}) => {
  const failures = [];

  if (!refExists(config.acceptedBaseline)) {
    failures.push(`accepted baseline is missing locally: ${config.acceptedBaseline}`);
  }
  if (!refExists(headRef)) failures.push(`Atom head ref is missing: ${headRef}`);
  if (!refExists(sourceRef)) failures.push(`upstream source ref is missing: ${sourceRef}`);
  if (!refExists(vendorRef)) failures.push(`vendor ref is missing: ${vendorRef}`);

  if (!ci) {
    if (!remoteExists("origin")) {
      failures.push("origin remote is missing");
    } else if (normalizeRepositoryUrl(remoteUrl("origin")) === upstreamRepository) {
      failures.push("origin still points to SPlayer upstream instead of the Atom repository");
    }

    if (branchExists("dev") && branchRemote("dev") !== "origin") {
      failures.push(`dev must track origin, found ${branchRemote("dev") || "no remote"}`);
    }
    if (branchExists("main") && branchRemote("main") !== "origin") {
      failures.push(`main must track origin, found ${branchRemote("main") || "no remote"}`);
    }
  }

  if (!remoteExists(config.remote)) {
    failures.push(`${config.remote} remote is missing`);
  } else {
    const fetchUrl = normalizeRepositoryUrl(remoteUrl(config.remote));
    if (fetchUrl !== upstreamRepository) {
      failures.push(
        `${config.remote} fetch URL must be ${config.repository}, found ${remoteUrl(config.remote)}`,
      );
    }
    const pushUrl = normalizeRepositoryUrl(pushRemoteUrl(config.remote));
    if (pushUrl === upstreamRepository) {
      failures.push(
        `${config.remote} must be fetch-only; its push URL still targets SPlayer upstream`,
      );
    }
  }

  if (refExists(config.acceptedBaseline) && refExists(headRef)) {
    if (!isAncestor(config.acceptedBaseline, headRef)) {
      failures.push(
        `accepted baseline ${config.acceptedBaseline} is not an ancestor of ${headRef}`,
      );
    }
  }

  if (refExists(config.acceptedBaseline) && refExists(sourceRef)) {
    if (!isAncestor(config.acceptedBaseline, sourceRef)) {
      failures.push(`accepted baseline is not present in official ${sourceRef} history`);
    }
  }

  if (refExists(vendorRef) && refExists(sourceRef)) {
    if (!isAncestor(vendorRef, sourceRef)) {
      failures.push(`${vendorRef} is not a commit from official ${sourceRef} history`);
    }
  }

  if (refExists(config.acceptedBaseline) && refExists(vendorRef)) {
    if (!isAncestor(config.acceptedBaseline, vendorRef)) {
      failures.push(`${vendorRef} is behind or unrelated to the accepted baseline`);
    }
  }

  printPair("Accepted baseline", config.acceptedBaseline);
  if (refExists(vendorRef)) printPair("Vendor ref", `${vendorRef} -> ${resolveCommit(vendorRef)}`);
  if (refExists(sourceRef))
    printPair("Fetched upstream", `${sourceRef} -> ${resolveCommit(sourceRef)}`);
  if (refExists(headRef)) printPair("Atom head", `${headRef} -> ${resolveCommit(headRef)}`);

  if (failures.length > 0) {
    console.error("\nUpstream topology check failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return false;
  }

  console.log("\nUpstream topology check passed.");
  return true;
};

const configure = () => {
  const atomOrigin = getOption("--origin");
  if (!atomOrigin) throw new Error("configure requires --origin <Atom repository URL>");
  if (normalizeRepositoryUrl(atomOrigin) === upstreamRepository) {
    throw new Error("Atom origin must not point to the SPlayer upstream repository");
  }

  if (!remoteExists(config.remote)) {
    if (
      remoteExists("origin") &&
      normalizeRepositoryUrl(remoteUrl("origin")) === upstreamRepository
    ) {
      runGit(["remote", "rename", "origin", config.remote]);
    } else {
      runGit(["remote", "add", config.remote, config.repository]);
    }
  }

  if (normalizeRepositoryUrl(remoteUrl(config.remote)) !== upstreamRepository) {
    throw new Error(`${config.remote} already exists but does not point to ${config.repository}`);
  }

  runGit(["config", "--unset-all", `remote.${config.remote}.pushurl`], { allowFailure: true });
  runGit(["config", "--add", `remote.${config.remote}.pushurl`, "DISABLED"]);

  if (!remoteExists("origin")) {
    runGit(["remote", "add", "origin", atomOrigin]);
  } else if (normalizeRepositoryUrl(remoteUrl("origin")) !== normalizeRepositoryUrl(atomOrigin)) {
    throw new Error(
      `origin already points to ${remoteUrl("origin")}; refusing to replace it implicitly`,
    );
  }

  for (const branch of ["dev", "main"]) {
    if (!branchExists(branch)) continue;
    runGit(["config", `branch.${branch}.remote`, "origin"]);
    runGit(["config", `branch.${branch}.merge`, `refs/heads/${branch}`]);
  }

  if (!refExists(sourceRef)) {
    throw new Error(
      `${sourceRef} is unavailable after remote setup; run git fetch ${config.remote}`,
    );
  }
  if (!isAncestor(config.acceptedBaseline, sourceRef)) {
    throw new Error("accepted baseline is not part of the fetched official SPlayer history");
  }

  if (!branchExists(config.vendorBranch)) {
    runGit(["branch", config.vendorBranch, config.acceptedBaseline]);
  }

  verifyState();
};

const advanceVendor = () => {
  runGit(["fetch", config.remote, config.sourceBranch]);

  if (!branchExists(config.vendorBranch)) {
    runGit(["branch", config.vendorBranch, config.acceptedBaseline]);
  }

  const targetRef = getOption("--target") || sourceRef;
  if (!refExists(targetRef)) throw new Error(`target ref is missing: ${targetRef}`);
  if (!isAncestor(targetRef, sourceRef)) {
    throw new Error(`${targetRef} is not contained in official ${sourceRef} history`);
  }

  const currentVendor = resolveCommit(config.vendorBranch);
  const target = resolveCommit(targetRef);
  if (!isAncestor(currentVendor, target)) {
    throw new Error(`refusing non-fast-forward vendor update: ${currentVendor} -> ${target}`);
  }

  const currentBranch = runGit(["branch", "--show-current"]).stdout;
  if (currentBranch === config.vendorBranch) {
    throw new Error(
      `refusing to move checked-out ${config.vendorBranch}; switch to an Atom branch first`,
    );
  }

  runGit(["branch", "-f", config.vendorBranch, target]);
  printPair("Vendor advanced", `${currentVendor} -> ${target}`);
  console.log(`Push the mirror explicitly after review: git push origin ${config.vendorBranch}`);
};

const integrationReport = () => {
  const vendorRef = getOption("--vendor-ref") || config.vendorBranch;
  const targetRef = getOption("--target") || sourceRef;
  const headRef = getOption("--head") || "dev";
  const ci = hasOption("--ci");

  if (!verifyState({ vendorRef, ci, headRef })) return;
  if (!refExists(targetRef)) throw new Error(`target ref is missing: ${targetRef}`);
  if (!isAncestor(vendorRef, targetRef)) {
    throw new Error(`${targetRef} would move ${vendorRef} non-fast-forward`);
  }

  const count = git(["rev-list", "--count", `${config.acceptedBaseline}..${targetRef}`]);
  printPair("Upstream commits since accepted baseline", count);
  const summary = git(["diff", "--stat", config.acceptedBaseline, targetRef]);
  if (summary) console.log(`\n${summary}`);

  const merge = runGit(["merge-tree", "--write-tree", headRef, targetRef], { allowFailure: true });
  if (!merge.ok) {
    console.error("\nCandidate upstream merge has conflicts:");
    console.error(merge.stdout || merge.stderr);
    process.exitCode = 1;
    return;
  }

  console.log("\nCandidate upstream merge is conflict-free.");
};

const recordBaseline = () => {
  const targetRef = getOption("--target") || config.vendorBranch;
  if (!refExists(targetRef)) throw new Error(`target ref is missing: ${targetRef}`);
  if (!refExists(sourceRef)) throw new Error(`upstream source ref is missing: ${sourceRef}`);

  const target = resolveCommit(targetRef);
  const vendor = resolveCommit(config.vendorBranch);
  if (target !== vendor) {
    throw new Error(
      `accepted baseline must equal ${config.vendorBranch}; found ${target} vs ${vendor}`,
    );
  }
  if (!isAncestor(target, sourceRef)) {
    throw new Error("accepted baseline candidate is not from official SPlayer history");
  }
  if (!isAncestor(target, "dev")) {
    throw new Error("accepted baseline candidate has not been integrated into Atom dev");
  }

  const nextConfig = { ...config, acceptedBaseline: target };
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  printPair("Accepted baseline recorded", target);
};

const printHelp = () => {
  console.log(
    `Usage: node scripts/atom/upstream-sync.mjs <command> [options]\n\nCommands:\n  status\n  configure --origin <url>\n  advance [--target <ref>]\n  report [--vendor-ref <ref>] [--target <ref>] [--head <ref>] [--ci]\n  record-baseline [--target <ref>]`,
  );
};

try {
  switch (command) {
    case "status":
      verifyState();
      break;
    case "configure":
      configure();
      break;
    case "advance":
      advanceVendor();
      break;
    case "report":
      integrationReport();
      break;
    case "record-baseline":
      recordBaseline();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      printHelp();
      throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
