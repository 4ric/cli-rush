import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumTextFileBytes = 20 * 1024 * 1024;

const prohibitedReferenceNames = new Set([
  "big site router.txt",
  "big site switch1.txt",
  "big site switch2.txt",
  "big site switch3.txt",
  "small site router.txt",
  "small site switch1.txt",
  "small site switch2.txt",
]);

const prohibitedReferenceDirectories = new Set([
  "configuration-references",
  "production-configs",
  "reference-configs",
  "source-configs",
]);

const prohibitedReferenceExtensions = new Set([
  ".cer", ".cfg", ".conf", ".crt", ".jks", ".key", ".p12", ".pcap", ".pcapng", ".pem", ".pfx",
]);

const ignoredDiscoveryDirectories = new Set([
  ".git", ".next", ".sites-runtime", ".wrangler", "data", "dist", "node_modules", "outputs", "secrets", "work",
]);

const textExtensions = new Set([
  "", ".cfg", ".conf", ".css", ".example", ".html", ".js", ".jsx", ".json",
  ".map", ".md", ".mjs", ".sh", ".svg", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const normalisePath = (value) => value.replaceAll("\\", "/").replace(/^\.\//u, "");

const isReferencePath = (relativePath) => {
  const normalised = normalisePath(relativePath).toLowerCase();
  const parts = normalised.split("/");
  const extension = path.posix.extname(normalised);
  return prohibitedReferenceNames.has(parts.at(-1) ?? "") ||
    parts.some((part) => prohibitedReferenceDirectories.has(part)) ||
    prohibitedReferenceExtensions.has(extension);
};

const isTextPath = (relativePath) => {
  const normalised = normalisePath(relativePath);
  const basename = path.posix.basename(normalised);
  return basename === "Dockerfile" || basename.startsWith(".env") ||
    textExtensions.has(path.posix.extname(normalised).toLowerCase());
};

const lineNumberAt = (content, index) => content.slice(0, index).split("\n").length;

const isPlaceholder = (value) => /^(?:<[^>]+>|\$\{[^}]+\}|\[[^\]]+\]|REDACTED|CHANGEME)$/iu.test(value);
const authorisedSeedValue = ["Str0ng", "Enable!"].join("");
const authorisedSeedCommand = ["enable secret", authorisedSeedValue].join(" ");

const sanitiseAuthorisedSeed = (line, relativePath) => {
  const normalised = normalisePath(relativePath);
  const quotedCommand = JSON.stringify(authorisedSeedCommand);
  const sourceStep = normalised === "lib/lab-content.ts" && /\bstep\("enable-secret"/u.test(line) && line.includes(quotedCommand);
  const coverage = normalised === "tests/engine/lab-content.test.ts" && (
    line.trim().replace(/,$/u, "") === quotedCommand ||
    (/\bsecretCommands\([^)]*\)/u.test(line) && line.includes(quotedCommand))
  );
  if (!sourceStep && !coverage && !normalised.startsWith("dist/")) return line;
  return line.replaceAll(authorisedSeedCommand, "enable secret <authorised-seeded-fixture>");
};

const isMaskOrWildcard = (octets) => {
  const bits = octets.map((octet) => octet.toString(2).padStart(8, "0")).join("");
  return /^1*0*$/u.test(bits) || /^0*1*$/u.test(bits);
};

const isPrivateIpv4 = ([first, second]) => first === 10 ||
  (first === 172 && second >= 16 && second <= 31) ||
  (first === 192 && second === 168);

const isAllowedIpv4 = (value) => {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  if (isMaskOrWildcard(octets)) return true;
  const [first, second, third] = octets;
  return isPrivateIpv4(octets) || first === 127 || first >= 224 ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113);
};

const isAllowedIpv6 = (value) => {
  if (net.isIP(value) !== 6) return true;
  const lower = value.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("2001:db8:") ||
    lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") ||
    lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
};

const isPrivateIpv6 = (value) => {
  const lower = value.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") ||
    lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
};

const contentRules = [
  {
    id: "certificate-or-private-key-block",
    pattern: /-----BEGIN\s+(?:CERTIFICATE|(?:[A-Z0-9]+\s+)*PRIVATE KEY)-----/giu,
  },
  {
    id: "vpn-or-tunnel-key-material",
    pattern: /\b(?:crypto\s+(?:ikev2|isakmp|ipsec|map)|tunnel\s+protection\s+ipsec)\b/giu,
  },
  {
    id: "cisco-password-hash",
    pattern: /\b(?:password|secret)\s+(?:5|7|8|9)\s+[^\s"'`]+/giu,
  },
  {
    id: "direct-application-secret",
    pattern: /CLI_RUSH_(?:PASSWORD_HASH|SESSION_SECRET)\b["']?\s*[:=]\s*(?!["']?(?:\$\{|<|REDACTED\b))["']?[^\s#"',}]{8,}/giu,
  },
];

const literalCredentialPatterns = [
  /(?:^\s*|["'`])enable\s+secret\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
  /(?:^\s*|["'`])username\s+\S+[^\r\n"'`]*\bsecret\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
  /(?:^\s*|["'`])radius-server\b[^\r\n"'`]*\bkey\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
  /(?:^\s*|["'`])key\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
  /(?:^\s*|["'`])snmp-server\s+community\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
  /(?:^\s*|["'`])password\s+([^\s"'`]+)(?=\s*(?:$|["'`]))/iu,
];
const codeFilePattern = /\.(?:js|jsx|map|mjs|ts|tsx)$/iu;

const scanContent = (content, relativePath) => {
  const findings = [];
  const normalisedPath = normalisePath(relativePath);
  const deploymentPath = normalisedPath === ".env.example" || normalisedPath === "compose.yaml" ||
    normalisedPath === "DOCKER-DEPLOY.md" || normalisedPath === "README.md" ||
    normalisedPath.startsWith("deploy/") || normalisedPath.startsWith("server/");
  for (const rule of contentRules) {
    for (const match of content.matchAll(rule.pattern)) {
      findings.push({ file: relativePath, line: lineNumberAt(content, match.index ?? 0), rule: rule.id });
    }
  }

  const lines = content.split(/\r?\n/u);
  lines.forEach((rawLine, index) => {
    const line = sanitiseAuthorisedSeed(rawLine, relativePath);
    for (const pattern of literalCredentialPatterns) {
      const match = line.match(pattern);
      const value = match?.[1] ?? "";
      const generatedCodeAssignment = codeFilePattern.test(normalisedPath)
        && /^(?:=|\+=)$/u.test(value)
        && /^\s*key\s+(?:=|\+=)(?:\s|$)/u.test(line);
      if (match && !isPlaceholder(value) && !generatedCodeAssignment) {
        findings.push({ file: relativePath, line: index + 1, rule: "literal-credential-or-community" });
        break;
      }
    }

    for (const match of line.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu)) {
      const octets = match[0].split(".").map(Number);
      if (deploymentPath && isPrivateIpv4(octets)) {
        findings.push({ file: relativePath, line: index + 1, rule: "private-deployment-ipv4" });
      } else if (!isAllowedIpv4(match[0])) {
        findings.push({ file: relativePath, line: index + 1, rule: "non-documentation-public-ipv4" });
      }
    }

    for (const match of line.matchAll(/(?<![#\w-])(?=[0-9A-Fa-f:]*:)[0-9A-Fa-f:]{3,}(?![\w-])/gu)) {
      const candidate = match[0].replace(/^:+|:+$/gu, "");
      if (candidate.includes(":") && net.isIP(candidate) === 6) {
        if (deploymentPath && isPrivateIpv6(candidate)) {
          findings.push({ file: relativePath, line: index + 1, rule: "private-deployment-ipv6" });
        } else if (!isAllowedIpv6(candidate)) {
          findings.push({ file: relativePath, line: index + 1, rule: "non-documentation-public-ipv6" });
        }
      }
    }
  });
  return findings;
};

const collectFiles = async (directory, root) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute, root));
    else if (entry.isFile()) files.push(normalisePath(path.relative(root, absolute)));
  }
  return files;
};

const collectProhibitedPaths = async (directory, root) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const absolute = path.join(directory, entry.name);
    const relative = normalisePath(path.relative(root, absolute));
    if (isReferencePath(relative)) {
      files.push(relative);
      continue;
    }
    const topLevelDirectory = relative.split("/")[0]?.toLowerCase();
    if (entry.isDirectory() && !ignoredDiscoveryDirectories.has(topLevelDirectory)) {
      files.push(...await collectProhibitedPaths(absolute, root));
    }
  }
  return files;
};

export const trackedFiles = (root = projectRoot) => {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to enumerate tracked files for the sensitive-content scan.");
  return result.stdout.split("\0").filter(Boolean).map(normalisePath);
};

export const scanSensitiveContent = async ({
  root = projectRoot,
  files = trackedFiles(root),
  includeDist = true,
} = {}) => {
  const selected = new Set(files.map(normalisePath));
  for (const file of await collectProhibitedPaths(root, root)) selected.add(file);
  if (includeDist) {
    for (const file of await collectFiles(path.join(root, "dist"), root)) selected.add(file);
  }

  const findings = [];
  for (const relativePath of [...selected].sort()) {
    if (isReferencePath(relativePath)) {
      findings.push({ file: relativePath, line: 0, rule: "prohibited-source-reference" });
      continue;
    }
    if (!isTextPath(relativePath)) continue;
    const absolute = path.resolve(root, relativePath);
    const metadata = await stat(absolute).catch(() => null);
    if (!metadata?.isFile()) continue;
    if (metadata.size > maximumTextFileBytes) {
      findings.push({ file: relativePath, line: 0, rule: "unscanned-oversized-text" });
      continue;
    }
    const content = await readFile(absolute, "utf8");
    if (content.includes("\0")) continue;
    findings.push(...scanContent(content, relativePath));
  }
  return findings;
};

export const formatFindings = (findings) => findings.map(({ file, line, rule }) =>
  `- ${file}${line ? `:${line}` : ""} [${rule}]`,
).join("\n");

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const findings = await scanSensitiveContent();
  if (findings.length) {
    console.error(`Sensitive-content scan failed with ${findings.length} finding(s). Values are intentionally suppressed.`);
    console.error(formatFindings(findings));
    process.exitCode = 1;
  } else {
    console.log("Sensitive-content scan passed for tracked source and available production artefacts.");
  }
}
