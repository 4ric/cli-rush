import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "outputs");

const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
};

if (git("status", "--porcelain", "--untracked-files=no")) {
  throw new Error("Commit tracked changes before creating a deployment archive.");
}

await mkdir(outputDirectory, { recursive: true });
const shortCommit = git("rev-parse", "--short=12", "HEAD");
const archives = [
  { format: "zip", path: resolve(outputDirectory, `cli-rush-docker-${shortCommit}.zip`) },
  { format: "tar.gz", path: resolve(outputDirectory, `cli-rush-docker-${shortCommit}.tar.gz`) },
];

for (const archive of archives) {
  git(
    "archive",
    "--worktree-attributes",
    `--format=${archive.format}`,
    "--prefix=cli-rush/",
    `--output=${archive.path}`,
    "HEAD",
  );
}

const checksums = [];
for (const archive of archives) {
  const digest = createHash("sha256").update(await readFile(archive.path)).digest("hex");
  checksums.push(`${digest}  ${archive.path.split(/[\\/]/u).at(-1)}`);
}
checksums.push(`commit  ${git("rev-parse", "HEAD")}`);
await writeFile(resolve(outputDirectory, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);

console.log(`Created Docker deployment archives for ${shortCommit} in ${outputDirectory}.`);
