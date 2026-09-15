import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../data-dir";

// Encryption for secrets at rest (GitHub tokens). The key comes from CODEBASE_AI_SECRET, or is generated once
// into <data dir>/secret.key (the data dir is gitignored). Nothing here ever logs secret material.

let cachedKey: Buffer | null = null;

export function secretKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.CODEBASE_AI_SECRET) {
    cachedKey = crypto.createHash("sha256").update(process.env.CODEBASE_AI_SECRET).digest();
    return cachedKey;
  }
  const dir = dataDir();
  const file = path.join(dir, "secret.key");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  return cachedKey;
}

export function encrypt(plain: string, key: Buffer = secretKey()): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string, key: Buffer = secretKey()): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Invalid encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
