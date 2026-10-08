import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostname } from "node:os";
const exec = promisify(execFile);
export async function processIdentity(pid: number): Promise<string | null> {
  try {
    if (process.platform === "linux") {
      const [stat, boot] = await Promise.all([
        readFile(`/proc/${pid}/stat`, "utf8"),
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      ]);
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return `${boot.trim()}:${fields[19]}`;
    }
    const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
    return stdout.trim() ? `${hostname()}:${stdout.trim()}` : null;
  } catch { return null; }
}
