import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

async function hiddenPrompt(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run this command from an interactive terminal.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  return await new Promise((resolve, reject) => {
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish();
        reject(new Error("Cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        process.stdin.off("data", onData);
        finish();
        resolve(value);
        return;
      }
      if (character === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      if (character >= " ") value += character;
    };
    process.stdin.on("data", onData);
  });
}

const password = await hiddenPrompt("Choose the CLI RUSH password: ");
const confirmation = await hiddenPrompt("Confirm the password: ");
if (password !== confirmation) throw new Error("Passwords do not match.");
if (password.length < 14) throw new Error("Use at least 14 characters.");

const salt = randomBytes(24);
const derived = await scrypt(password, salt, 64, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
const sessionSecret = randomBytes(48).toString("base64url");

await mkdir("secrets", { recursive: true, mode: 0o700 });
for (const [path, value] of [
  ["secrets/password_hash", passwordHash],
  ["secrets/session_secret", sessionSecret],
]) {
  const handle = await open(path, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") {
      throw new Error(`${path} already exists. Move it away before rotating secrets.`);
    }
    throw error;
  });
  await handle.writeFile(`${value}\n`);
  await handle.close();
}
await writeFile("secrets/.created", `${new Date().toISOString()}\n`, { mode: 0o600 });
console.log("Created password and session secrets in ./secrets.");
