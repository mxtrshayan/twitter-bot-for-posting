import { createServer } from "node:http";
import type { Page } from "playwright";
export const fixtureOrigin = "http://127.0.0.1:3002";
export function startPersistenceFixture(port = 3002) {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      "<!doctype html><html><head><title>Local profile persistence test</title></head><body><h1>Local profile persistence test</h1><p>This page tests only project-owned cookies, localStorage and IndexedDB. It does not log in to another website.</p></body></html>",
    );
  });
  return new Promise<typeof server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
export async function writeFixture(page: Page, value: string) {
  await page.evaluate(async (value) => {
    document.cookie = `profile_persistence_fixture=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Strict`;
    localStorage.setItem("profile_persistence_fixture", value);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("profile-persistence-fixture", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("values");
      request.onerror = () => reject(new Error("IndexedDB open failed"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("values", "readwrite");
        transaction.objectStore("values").put(value, "marker");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(new Error("IndexedDB write failed"));
        };
      };
    });
  }, value);
}
export async function readFixture(page: Page) {
  return page.evaluate(async () => {
    const cookie = document.cookie
      .split("; ")
      .find((value) => value.startsWith("profile_persistence_fixture="))
      ?.split("=")
      .slice(1)
      .join("=");
    const local = localStorage.getItem("profile_persistence_fixture");
    const indexed = await new Promise<string | null>((resolve, reject) => {
      const request = indexedDB.open("profile-persistence-fixture", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("values");
      request.onerror = () => reject(new Error("IndexedDB open failed"));
      request.onsuccess = () => {
        const database = request.result;
        const get = database
          .transaction("values", "readonly")
          .objectStore("values")
          .get("marker");
        get.onsuccess = () => {
          database.close();
          resolve(get.result ?? null);
        };
        get.onerror = () => {
          database.close();
          reject(new Error("IndexedDB read failed"));
        };
      };
    });
    return {
      cookie: cookie ? decodeURIComponent(cookie) : null,
      localStorage: local,
      indexedDB: indexed,
    };
  });
}
