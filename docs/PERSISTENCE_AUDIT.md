# Persistence audit

## Findings before changes

1. `scripts/profile-host.ts` launches installed Chrome using `chromium.launch({channel: "chrome", chromiumSandbox: true})`, then creates `browser.newContext({storageState})`. Account browsers are temporary contexts, not persistent Chrome profiles.
2. `launchPersistentContext()` is not used by the account host. Browser 1–5 have no application-owned permanent userDataDir mapping. Playwright creates temporary browser directories.
3. Authentication snapshots are encrypted in PostgreSQL (`BrowserProfile.encryptedSession`). Close exports cookies/localStorage/IndexedDB, then closes Chrome. The underlying temporary profile is discarded by Playwright; history/cache/full browser state are not preserved by the export.
4. There is no explicit application deletion of permanent profile directories because none exists. Failures previously closed temporary contexts; the navigation fix keeps failed visible windows open, but does not add permanent storage.
5. Snapshots are independent by database row, but are not five independent on-disk Chrome installations.
6. The Docker posting worker uses bundled Chromium and temporary contexts restored from encrypted snapshots. The Mac host uses installed Chrome and its own temporary contexts. These are different browser/session mechanisms.
7. A live in-memory map and single host heartbeat exist, but there is no per-directory cross-process lock. Closing a window manually does not reliably reconcile the dashboard registry.
8. The previous manual login command also uses a temporary context, exports encrypted JSON and copies it into Docker. It is not the desired persistent manual-browser workflow.
9. The five proxies were temporarily detached and disabled at the user's request. The original assignments are safely recorded in `data/proxy-pause-backup.json`. DIRECT must remain the current choice; restoring assignment metadata must not silently enable proxy routing.
10. Host Chrome uses a dedicated temporary directory, not the personal Chrome profile. The replacement must use only project-owned directories and never personal Chrome's Default directory.

## Replacement design

Five fixed IDs map to `data/browser-profiles/browser-1` through `browser-5` under the project. The host uses `launchPersistentContext` with installed Chrome, visible windows and explicit sandboxing. Chrome's user-data directory is the primary source of truth. No storage snapshot is imported, no login watcher runs and no credentials are filled.

Each profile has a DIRECT/PROXY selection independent of its retained proxy assignment. Per-profile filesystem locks prevent duplicate launches; the host tracks context, browser PID, path and launch time, waits for Chrome exit, and reconciles manual closure. Create is idempotent. Only explicitly confirmed Reset may delete the selected project-owned directory. Navigation, proxy and website failures never delete profile state.

The dashboard presents five cards with Open/Close, Open X/Instagram/Google, Create, Test Persistence and confirmed Reset. Browser opening never queues a login or posting job. Existing posting functionality remains outside this workflow and cannot consume or overwrite these live persistent directories.

## Verification

Actual visible Mac Chrome persistence and isolation test results will be appended after execution. Real third-party authentication remains operator-controlled; websites can revoke sessions.

## Executed verification results

- Actual visible installed Chrome 154 was launched on macOS for Browser 1 and Browser 2 using their permanent project directories. Distinct Chrome PIDs were captured through a browser CDP session.
- Profile-specific persistent cookies, localStorage and IndexedDB survived context closure, confirmed process exit and reopening the exact same directory. Browser 1 retained its own marker; Browser 2 retained a different marker.
- Closing the final user page initially left Playwright's Chrome process alive. Fixed by gracefully closing the persistent context when its final page/window closes. The rerun verified Chrome exits, the registry releases its lock and the dashboard callback reconciles Stopped.
- Chrome's on-disk History retained local navigation after shutdown. All five directories contained independent Chrome-generated `Local State` and `Default/Preferences`, with owner-only directory permissions.
- Same-profile open was rejected both within one manager and from a second manager sharing the root. Navigation failure, missing/unreachable proxy, and DIRECT→PROXY→DIRECT did not remove the profile or its local state.
- The deployed dashboard/host test opened five actual visible processes, verified distinct PIDs and paths, confirmed reset rejection without confirmation, switched connection metadata without changing the directory inode, and ran persistence checks for Browsers 1 and 2 through the queue.
- Typecheck, lint, 17 unit tests, shell syntax, the legacy local mock/API/worker integration and local security regression fixtures passed. No real X/Instagram/Google authentication or publication occurred during this migration.
- Original Oxylabs assignment metadata was retained for the connection selector; all five remain DIRECT. Old encrypted snapshots were not imported into the new directories and remain separate legacy artifacts.

## Remaining limits

Chrome user-data directories are sensitive real browser state, not application-encrypted cookie exports. Filesystem permissions and Chrome's normal OS-backed protections apply; the full directory is not encrypted with `APP_ENCRYPTION_KEY`. These are browser profiles on one macOS account, not VMs. Website login acceptance and session expiration/revocation remain controlled by each website. The Docker worker is not authorized to consume these manual profiles. Standalone persistence tests require the host to be stopped because they share the dedicated directories and local fixture port.
