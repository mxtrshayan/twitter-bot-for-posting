import { lstat, realpath, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  browserIds,
  getProfilePath,
} from "../packages/browser/persistent-profiles";
const paths = browserIds.map((id) => getProfilePath(id));
if (new Set(paths).size !== 5) throw new Error("Profiles share a directory");
for (const [index, path] of paths.entries()) {
  if (
    path.startsWith(`${resolve(tmpdir())}/`) ||
    path.startsWith("/private/tmp/") ||
    path.startsWith("/tmp/")
  )
    throw new Error("Profile is temporary");
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== path
  )
    throw new Error("Profile path is not a dedicated real directory");
  if (process.getuid && info.uid !== process.getuid())
    throw new Error("Unexpected profile owner");
  if ((info.mode & 0o777) !== 0o700)
    throw new Error("Expected owner-only directory permissions (0700)");
  await access(join(path, "Local State"));
  await access(join(path, "Default", "Preferences"));
  console.log(
    `PASS ${browserIds[index]}: ${path}; real Chrome profile, distinct path, owner-only permissions`,
  );
}
console.log(
  "PASS: five permanent, independent project-owned Chrome profile directories.",
);
