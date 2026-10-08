import { processIdentity } from "./process-identity";
import {
  chromium,
  type BrowserContext,
  type Page,
  type LaunchOptions,
} from "playwright";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hostBrowserOptions } from "./runtime";
import { safeBrowserFailure } from "./manual-navigation";
export const browserIds = [
  "browser-1",
  "browser-2",
  "browser-3",
  "browser-4",
  "browser-5",
] as const;
export type BrowserId = (typeof browserIds)[number];
export type ConnectionMode = "DIRECT" | "PROXY";
export type ProfileConnection = {
  mode: ConnectionMode;
  proxyId?: string | null;
  headless?: boolean;
  proxy?: LaunchOptions["proxy"];
};
export type LiveProfile = {
  id: BrowserId;
  context: BrowserContext;
  pid: number;
  profilePath: string;
  startedAt: Date;
  connection: ProfileConnection;
  closing?: Promise<void>;
};
export type ProfileEvent = {
  id: BrowserId;
  event: string;
  profilePath: string;
  pid?: number;
  connectionMode?: ConnectionMode;
  proxyId?: string | null;
  startedAt?: string;
  exitTime?: string;
  url?: string;
  httpStatus?: number;
  error?: string;
};
export class ProfileError extends Error {}
export const resetConfirmation =
  "This permanently deletes this browser's saved websites, cookies, and login sessions.";
export function assertBrowserId(id: string): asserts id is BrowserId {
  if (!(browserIds as readonly string[]).includes(id))
    throw new ProfileError("Unknown browser profile");
}
export function getProfilePath(
  id: string,
  root = resolve("data/browser-profiles"),
) {
  assertBrowserId(id);
  return join(resolve(root), id);
}
export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
async function waitForExit(pid: number) {
  for (let count = 0; count < 200; count++) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new ProfileError(
    "Chrome is still exiting. Wait before opening this profile again.",
  );
}
export class PersistentProfiles {
  readonly live = new Map<BrowserId, LiveProfile>();
  private busy = new Set<BrowserId>();
  readonly root: string;
  constructor(
    root = resolve("data/browser-profiles"),
    private onEvent: (event: ProfileEvent) => void = () => {},
    private onExit: (id: BrowserId) => Promise<void> = async () => {},
  ) {
    this.root = resolve(root);
  }
  async create(id: BrowserId) {
    const path = getProfilePath(id, this.root);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.root)).isSymbolicLink() ||
      (await realpath(this.root)) !== this.root
    )
      throw new ProfileError(
        "Profile root must be a real project directory, not a symlink",
      );
    await chmod(this.root, 0o700);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ProfileError("Profile path must be a real directory");
      if (process.getuid && info.uid !== process.getuid())
        throw new ProfileError("Profile directory belongs to another user");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(path, { mode: 0o700 });
    }
    await chmod(path, 0o700);
    return path;
  }
  private lockPath(id: BrowserId) {
    return join(this.root, ".locks", `${id}.json`);
  }
  private async acquireLock(id: BrowserId) {
    const path = this.lockPath(id);
    await mkdir(join(this.root, ".locks"), { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const identity = await processIdentity(process.pid);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(path, JSON.stringify({ pid: process.pid, token, identity }), {
          flag: "wx",
          mode: 0o600,
        });
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // A malformed lock is treated as held. Never risk a concurrent profile launch.
        const owner = JSON.parse(await readFile(path, "utf8")) as {
          pid: number;
          identity?: string;
        };
        const liveIdentity = owner.identity ? await processIdentity(owner.pid) : null;
        const ownerAlive = isProcessAlive(owner.pid) &&
          (!owner.identity || !liveIdentity || owner.identity === liveIdentity);
        if (
          !Number.isInteger(owner.pid) ||
          owner.pid <= 0 ||
          ownerAlive
        )
          throw new ProfileError(
            `${id.replace("browser-", "Browser ")} is already running.`,
          );
        await rm(path); // Stale host lock only; Chrome's own profile lock is never removed.
      }
    }
    throw new ProfileError("Could not acquire profile lock");
  }
  private async releaseLock(id: BrowserId, token: string) {
    try {
      const owner = JSON.parse(await readFile(this.lockPath(id), "utf8"));
      if (owner.token === token) await rm(this.lockPath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async open(id: BrowserId, connection: ProfileConnection) {
    assertBrowserId(id);
    if (this.live.has(id) || this.busy.has(id))
      throw new ProfileError(
        `${id.replace("browser-", "Browser ")} is already running.`,
      );
    if (connection.mode === "PROXY" && !connection.proxy)
      throw new ProfileError("Assign an enabled proxy before selecting PROXY");
    this.busy.add(id);
    let token: string | undefined;
    let context: BrowserContext | undefined;
    const profilePath = getProfilePath(id, this.root);
    try {
      await this.create(id);
      token = await this.acquireLock(id);
      context = await chromium.launchPersistentContext(profilePath, {
        ...hostBrowserOptions,
        headless: connection.headless ?? false,
        timeout: 30000,
        acceptDownloads: false,
        handleSIGTERM: false,
        handleSIGINT: false,
        handleSIGHUP: false,
        ignoreHTTPSErrors: false,
        ...(connection.mode === "PROXY" ? { proxy: connection.proxy } : {}),
      });
      const browser = context.browser();
      if (!browser) throw new ProfileError("Chrome browser handle unavailable");
      const cdp = await browser.newBrowserCDPSession();
      const processes = await cdp.send("SystemInfo.getProcessInfo");
      await cdp.detach();
      const pid = processes.processInfo.find(
        (info: { type: string }) => info.type === "browser",
      )?.id;
      if (!pid || !Number.isInteger(pid))
        throw new ProfileError("Chrome PID unavailable");
      const entry: LiveProfile = {
        id,
        context,
        pid,
        profilePath,
        connection,
        startedAt: new Date(),
      };
      this.live.set(id, entry);
      const watchPage = (page: Page) =>
        page.on("close", () => {
          // Playwright-controlled Chrome can stay alive without windows. Finish the
          // graceful shutdown when the operator closes the final page/window.
          setTimeout(() => {
            if (
              this.live.get(id) === entry &&
              !entry.closing &&
              entry.context.pages().every((page) => page.isClosed())
            )
              void this.close(id).catch((error) =>
                this.log(entry, "exit-error", {
                  error:
                    error instanceof ProfileError
                      ? error.message
                      : "Exit cleanup failed",
                }),
              );
          }, 100);
        });
      context.pages().forEach(watchPage);
      context.on("page", watchPage);
      const lockToken = token;
      context.on("close", () => {
        if (!entry.closing) entry.closing = this.finalize(entry, lockToken);
        void entry.closing.catch((error) =>
          this.log(entry, "exit-error", {
            error:
              error instanceof ProfileError
                ? error.message
                : "Exit cleanup failed",
          }),
        );
      });
      this.log(entry, "opened", { startedAt: entry.startedAt.toISOString() });
      return entry;
    } catch (error) {
      await context?.close().catch(() => {});
      if (token) await this.releaseLock(id, token);
      if (error instanceof ProfileError) throw error;
      this.onEvent({
        id,
        event: "launch-failed",
        profilePath,
        connectionMode: connection.mode,
        proxyId: connection.proxyId,
        error: safeBrowserFailure(error),
      });
      throw new ProfileError(
        `Chrome could not open (${safeBrowserFailure(error)}). Profile data was preserved. Check Chrome and the selected connection.`,
      );
    } finally {
      this.busy.delete(id);
    }
  }
  private log(
    entry: LiveProfile,
    event: string,
    extra: Partial<ProfileEvent> = {},
  ) {
    this.onEvent({
      id: entry.id,
      event,
      profilePath: entry.profilePath,
      pid: entry.pid,
      connectionMode: entry.connection.mode,
      proxyId: entry.connection.proxyId,
      ...extra,
    });
  }
  private async finalize(entry: LiveProfile, token: string) {
    await waitForExit(entry.pid);
    await this.releaseLock(entry.id, token);
    if (this.live.get(entry.id) === entry) this.live.delete(entry.id);
    this.log(entry, "closed", { exitTime: new Date().toISOString() });
    await this.onExit(entry.id);
  }
  async close(id: BrowserId) {
    const entry = this.live.get(id);
    if (!entry) return;
    const closed = new Promise<void>((resolve) =>
      entry.context.once("close", () => resolve()),
    );
    await Promise.race([entry.context.close(), closed]);
    if (entry.closing) await entry.closing;
    else throw new ProfileError("Chrome close event was not received");
  }
  async navigate(id: BrowserId, url: string) {
    const entry = this.live.get(id);
    if (!entry) throw new ProfileError("Open this browser first");
    // Only public origin + path is logged; queries/fragments can contain authentication tokens.
    const location = new URL(url);
    const safeUrl = `${location.origin}${location.pathname}`;
    const page =
      entry.context.pages().find((page) => !page.isClosed()) ||
      (await entry.context.newPage());
    let httpStatus: number | undefined;
    const capture = (response: import("playwright").Response) => {
      if (
        response.request().isNavigationRequest() &&
        response.frame() === page.mainFrame()
      )
        httpStatus = response.status();
    };
    page.on("response", capture);
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      httpStatus = response?.status();
      this.log(entry, "navigation", { url: safeUrl, httpStatus });
      if (httpStatus && httpStatus >= 400)
        throw new ProfileError(
          `Website returned HTTP ${httpStatus}. Browser remains open; profile data was preserved.`,
        );
      await page.bringToFront();
      return page;
    } catch (error) {
      this.log(entry, "navigation-failed", {
        url: safeUrl,
        httpStatus,
        error: safeBrowserFailure(error),
      });
      if (error instanceof ProfileError) throw error;
      throw new ProfileError(
        httpStatus && httpStatus >= 400
          ? `Website returned HTTP ${httpStatus}. Browser remains open; profile data was preserved.`
          : `Navigation failed (${safeBrowserFailure(error)}). Browser remains open; profile data was preserved.`,
      );
    } finally {
      page.off("response", capture);
    }
  }
  async reset(id: BrowserId, confirmation: string) {
    if (confirmation !== resetConfirmation)
      throw new ProfileError("Explicit reset confirmation is required");
    if (this.live.has(id) || this.busy.has(id))
      throw new ProfileError("Close the browser before resetting its profile");
    await this.create(id);
    const token = await this.acquireLock(id);
    try {
      await rm(getProfilePath(id, this.root), { recursive: true });
      await this.create(id);
    } finally {
      await this.releaseLock(id, token);
    }
  }
}
export function pageFor(entry: LiveProfile): Page | undefined {
  return entry.context.pages().find((page) => !page.isClosed());
}
