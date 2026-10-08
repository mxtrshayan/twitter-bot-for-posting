import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentProfiles } from "../packages/browser/persistent-profiles";
import { parseXCookies, exportXCookies } from "../packages/browser/x-cookies";
import { encrypt, decrypt } from "../packages/shared/security";
const temporary = await mkdtemp(join(tmpdir(), "x-cookie-test-"));
const profiles = new PersistentProfiles(await realpath(temporary));
try {
  const one = await profiles.open("browser-1", {
    mode: "DIRECT",
    headless: true,
  });
  const two = await profiles.open("browser-2", {
    mode: "DIRECT",
    headless: true,
  });
  const cookies = parseXCookies(
    JSON.stringify([
      {
        name: "auth_token",
        value: "fixture-no-real-login",
        domain: ".x.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: Date.now() / 1000 + 3600,
      },
    ]),
  );
  await one.context.addCookies(cookies);
  assert.equal((await exportXCookies(two.context)).length, 0);
  const backup = encrypt(
    JSON.stringify({ cookies: await exportXCookies(one.context) }),
  );
  assert(!backup.includes("fixture-no-real-login"));
  assert.equal(
    JSON.parse(decrypt(backup)).cookies[0].value,
    "fixture-no-real-login",
  );
  await profiles.close("browser-1");
  const reopened = await profiles.open("browser-1", {
    mode: "DIRECT",
    headless: true,
  });
  assert.equal(
    (await exportXCookies(reopened.context)).find(
      (cookie) => cookie.name === "auth_token",
    )?.value,
    "fixture-no-real-login",
  );
  assert.equal((await exportXCookies(two.context)).length, 0);
  console.log(
    "PASS: headless persistent cookie import, encrypted backup, close/reopen and independent profiles. No X navigation or login request made.",
  );
} finally {
  for (const id of [...profiles.live.keys()]) await profiles.close(id);
  await rm(temporary, { recursive: true, force: true });
}
