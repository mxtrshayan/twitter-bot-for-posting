import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv(
    "aes-256-gcm",
    Buffer.from(config().APP_ENCRYPTION_KEY, "hex"),
    iv,
  );
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    iv.toString("hex"),
    data.toString("hex"),
    c.getAuthTag().toString("hex"),
  ].join(":");
}
export function decrypt(value: string) {
  const [iv, data, tag] = value.split(":");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config().APP_ENCRYPTION_KEY, "hex"),
    Buffer.from(iv, "hex"),
  );
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    d.update(Buffer.from(data, "hex")),
    d.final(),
  ]).toString("utf8");
}
export function token(purpose: "dashboard" | "mock" = "dashboard") {
  const expires = Date.now() + 86400000;
  const signature = createHmac("sha256", config().APP_ENCRYPTION_KEY)
    .update(`${purpose}:${expires}`)
    .digest("hex");
  return `${expires}.${signature}`;
}
export function validToken(
  value: string,
  purpose: "dashboard" | "mock" = "dashboard",
) {
  const [exp, sig] = value.split(".");
  if (!sig || !Number.isFinite(Number(exp)) || Number(exp) < Date.now())
    return false;
  const expected = createHmac("sha256", config().APP_ENCRYPTION_KEY)
    .update(`${purpose}:${exp}`)
    .digest("hex");
  return (
    Buffer.byteLength(sig) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
