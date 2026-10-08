"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
type Profile = {
  id: string;
  name: string;
  status: string;
  mode: string;
  connectionMode: string;
  proxyId: string | null;
  publicIp: string | null;
  ipCheckedAt: string | null;
  lastError: string | null;
  cookieCount: number;
  cookiesImportedAt: string | null;
  sessionStatus: string;
  sessionCheckedAt: string | null;
  sessionUsername: string | null;
  postStatus: string;
  postUrl: string | null;
  postError: string | null;
};
type State = {
  browserHostReady: boolean;
  profiles: Profile[];
  proxies: { id: string; host: string; port: number; enabled: boolean }[];
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Never";
const sessionLabel: Record<string, string> = {
  NONE: "Not connected",
  SAVED: "Cookies saved; connection not confirmed",
  VERIFIED: "Connected",
  REJECTED: "Not connected — X did not accept the session",
  CHECK_FAILED: "Connection check failed",
};
export default function Dashboard() {
  const [state, setState] = useState<State>();
  const [signed, setSigned] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [exports, setExports] = useState<Record<string, string>>({});
  const [postText, setPostText] = useState("");
  const [postingBrowser, setPostingBrowser] = useState("");
  const [lastPostingBrowser, setLastPostingBrowser] = useState("");
  const [batchTargets, setBatchTargets] = useState<Profile[]>([]);
  const [batchErrors, setBatchErrors] = useState<Record<string,string>>({});
  const connectedProfiles = state?.profiles.filter(p => p.sessionStatus === "VERIFIED" && p.sessionUsername) ?? [];
  const allSelected = postingBrowser === "all";
  const allAccounts = connectedProfiles.filter((profile, index, profiles) => profiles.findIndex(p => p.sessionUsername!.toLowerCase() === profile.sessionUsername!.toLowerCase()) === index);
  const selectedProfile = allSelected ? undefined : connectedProfiles.find(p => p.id === postingBrowser) ?? connectedProfiles[0];
  const targetProfiles = allSelected ? allAccounts : selectedProfile ? [selectedProfile] : [];
  const targetPosting = targetProfiles.some(p => p.postStatus === "POSTING");
  const postLength = Array.from(postText).length;
  const feedbackProfile = state?.profiles.find(p => p.id === lastPostingBrowser) ?? selectedProfile;
  const [connecting, setConnecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const visibleMessage = message.startsWith("Posting through ") && feedbackProfile?.postStatus !== "POSTING" ? "" : message;
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (response.status === 401) {
        setSigned(false);
        return;
      }
      if (!response.ok) throw new Error("Dashboard unavailable");
      setState(await response.json());
      setSigned(true);
    } catch {
      setMessage("Could not reach the dashboard. Start ./run.command.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function request(path: string, body: unknown) {
    const response = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }
  async function action(id: string, command: string) {
    setBusy(id);
    if (command === "POST_TEXT") { setLastPostingBrowser(id); setBatchTargets([]); setBatchErrors({}); }
    setMessage("");
    try {
      await request(`profiles/${id}`, {
        action: command,
        ...(command === "POST_TEXT" ? { text: postText } : {}),
        ...(command === "CONNECT_X" ? { cookies: exports[id] || "" } : {}),
      });
      if (command === "CONNECT_X")
        {
        setExports((previous) => ({ ...previous, [id]: "" }));
        setConnecting(null);
      }
      setMessage(
        command === "CONNECT_X"
          ? "Connecting account… The browser will save your cookies and check X automatically."
          : command === "CHECK_LOGIN" ? "Checking the saved session and public IP…" : command === "POST_TEXT" ? `Posting through ${state?.profiles.find(p => p.id === id)?.name || "selected browser"}…` : "Browser operation queued.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(null);
    }
  }
  async function postToTargets() {
    if (!allSelected) { if (selectedProfile) await action(selectedProfile.id, "POST_TEXT"); return; }
    const targets = [...targetProfiles];
    if (!targets.length || busy || targetPosting) return;
    const text = postText;
    setBusy("all");
    setBatchTargets(targets);
    setBatchErrors({});
    setMessage("");
    for (const profile of targets) {
      try { await request(`profiles/${profile.id}`, {action:"POST_TEXT",text}); }
      catch (error) { setBatchErrors(previous => ({...previous,[profile.id]:error instanceof Error ? error.message : "Could not queue this account. Check its status before retrying."})); }
    }
    await refresh();
    setBusy(null);
  }
  if (signed === false)
    return (
      <main style={{ maxWidth: 440, margin: "80px auto", padding: 24 }}>
        <h1>Launchpad</h1>
        <p>Sign in to manage your five private browser profiles.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await request("auth", { password });
              setPassword("");
              await refresh();
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Sign-in failed",
              );
            }
          }}
        >
          <label htmlFor="password">Dashboard password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Button type="submit" style={{ marginTop: 16 }}>
            Enter workspace
          </Button>
        </form>
        <p role="status">{message}</p>
      </main>
    );
  return (
    <main style={{ maxWidth: 1200, margin: "auto", padding: "36px 24px" }}>
      <header style={{ marginBottom: 28 }}>
        <h1>Launchpad</h1>
        <p>Your X accounts and their background browsers.</p>
        <p>{state?.profiles.length ?? 5} browsers · {state?.profiles.filter(p => p.status === "RUNNING").length ?? 0} running · {state?.profiles.filter(p => p.sessionStatus === "VERIFIED").length ?? 0} connected</p>
        {state && !state.browserHostReady && <p role="status">Browser service offline. Start ./run.command.</p>}
      </header>
      {visibleMessage && <p role="status" style={{ marginBottom: 20 }}>{visibleMessage}</p>}
      {state && <section className="panel post-composer" aria-labelledby="composer-title">
        <div className="panel-body">
          <div className="composer-heading"><div><h2 id="composer-title">Write a post</h2><p>Choose one account or all connected accounts. Each uses its own browser and proxy.</p></div><span className="composer-count">{connectedProfiles.length} connected accounts</span></div>
          <form onSubmit={event => { event.preventDefault(); void postToTargets(); }}>
            <label htmlFor="posting-account">Post to account</label>
            <select id="posting-account" value={allSelected ? "all" : selectedProfile?.id || ""} onChange={event => setPostingBrowser(event.target.value)} disabled={!!busy || !connectedProfiles.length || targetPosting}>
              {!connectedProfiles.length && <option value="">Connect an X account below</option>}
              {!!connectedProfiles.length && <option value="all">All connected accounts ({allAccounts.length})</option>}
              {connectedProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.sessionUsername} · {profile.name}</option>)}
            </select>
            {allSelected && <p className="composer-route">{allAccounts.map(p => `${p.sessionUsername} · ${p.name}`).join(" / ")} · One post per account</p>}
            {selectedProfile && <p className="composer-route">{selectedProfile.name} · IP {selectedProfile.publicIp || "available when started"} · {state.proxies.find(p => p.id === selectedProfile.proxyId)?.host || "Proxy not configured"}</p>}
            <label className="sr-only" htmlFor="post-text">Write a post</label>
            <textarea id="post-text" rows={5} value={postText} onChange={event => setPostText(event.target.value)} placeholder="What would you like to share?" disabled={!!busy || targetPosting} aria-describedby="post-counter" />
            <div className="composer-footer"><span id="post-counter" className={postLength > 280 ? "composer-limit" : "composer-counter"}>{postLength}/280 characters</span><Button type="submit" disabled={!!busy || !state.browserHostReady || !targetProfiles.length || !postText.trim() || postLength > 280 || targetPosting}>{targetPosting || busy === "all" ? "Posting…" : allSelected && allAccounts.length ? `Post to all ${allAccounts.length} accounts` : selectedProfile ? `Post to ${selectedProfile.sessionUsername}` : "Connect an account to post"}</Button></div>
            {!!batchTargets.length && <div className="batch-results" aria-live="polite">
              {batchTargets.map(target => {
                const profile = state.profiles.find(p => p.id === target.id);
                const error = batchErrors[target.id];
                return <p key={target.id}><strong>{target.sessionUsername} · {target.name}</strong>: {error ? <span className="composer-limit">Not queued: {error}</span> : profile?.postStatus === "POSTING" || busy === "all" ? "Queued / posting…" : profile?.postStatus === "POSTED" && profile.postUrl ? <a href={profile.postUrl} target="_blank" rel="noreferrer">Published · View post on X ↗</a> : <span className="composer-limit">{profile?.postError || "Waiting for account result…"}</span>}</p>;
              })}
            </div>}
            {!batchTargets.length && feedbackProfile?.postStatus === "POSTED" && feedbackProfile.postUrl && <p role="status" className="composer-result">Published to {feedbackProfile.sessionUsername}. <a href={feedbackProfile.postUrl} target="_blank" rel="noreferrer">View post on X ↗</a></p>}
            {!batchTargets.length && feedbackProfile?.postError && <p role="status" className="composer-limit">{feedbackProfile.name}: {feedbackProfile.postError}</p>}
          </form>
        </div>
      </section>}
      {!state ? <p>Loading browsers…</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {state.profiles.map(profile => {
            const proxy = state.proxies.find(item => item.id === profile.proxyId);
            const running = profile.status === "RUNNING";
            const connected = profile.sessionStatus === "VERIFIED";
            const disabled = !!busy || !state.browserHostReady;
            return (
              <section className="panel" key={profile.id} data-testid={`browser-card-${profile.id}`}>
                <div className="panel-head">
                  <h2>{profile.name}</h2>
                  <span className={`badge ${running ? "RUNNING" : "STOPPED"}`}>{running ? "Running" : "Stopped"}</span>
                </div>
                <div className="panel-body">
                  <p><strong>{connected ? profile.sessionUsername || "Connected X account" : "No connected X account"}</strong><br />{sessionLabel[profile.sessionStatus] || "Not connected"}</p>
                  <p>Browser: {profile.mode === "VIRTUAL" ? "Chromium (virtual display)" : "Headless Chrome"}<br />Proxy: {profile.connectionMode === "PROXY" && proxy ? `${proxy.host}:${proxy.port}${proxy.enabled ? "" : " (disabled)"}` : "Not configured"}<br />Public IP: <strong>{profile.publicIp || "Available when started"}</strong></p>
                  {profile.sessionCheckedAt && <p style={{ fontSize: 12 }}>Connection last checked: {date(profile.sessionCheckedAt)}</p>}
                  {profile.lastError && <p role="status" style={{ color: "#b45309", overflowWrap: "anywhere" }}>{profile.lastError}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button disabled={disabled} onClick={() => { setConnecting(profile.id); setMessage(""); }}>{connected ? "Change X account" : "Connect X account"}</Button>
                    {profile.cookiesImportedAt && <Button disabled={disabled} onClick={() => void action(profile.id, "CHECK_LOGIN")}>Recheck connection</Button>}
                    <Button disabled={disabled} onClick={() => void action(profile.id, running ? "CLOSE" : "OPEN")}>{running ? "Stop browser" : "Start browser"}</Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {connecting && (
        <div style={{ position: "fixed", inset: 0, background: "#0008", display: "grid", placeItems: "center", padding: 20, zIndex: 20 }}>
          <section role="dialog" aria-modal="true" aria-labelledby="connect-title" className="panel" style={{ width: "100%", maxWidth: 560 }}>
            <div className="panel-body">
              <h2 id="connect-title">Connect X account · {state?.profiles.find(p => p.id === connecting)?.name}</h2>
              <p>Paste your signed-in x.com cookies from EditThisCookie. We’ll save them in this browser and check your account automatically.</p>
              <form onSubmit={event => { event.preventDefault(); void action(connecting, "CONNECT_X"); }}>
                <label htmlFor="connect-cookies">Cookie JSON</label>
                <textarea id="connect-cookies" autoFocus autoComplete="off" spellCheck={false} rows={8} style={{ width: "100%", margin: "8px 0 16px", fontFamily: "monospace" }} value={exports[connecting] || ""} onChange={event => setExports(previous => ({ ...previous, [connecting]: event.target.value }))} required />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="submit" disabled={!!busy || !exports[connecting]?.trim()}>Connect account</Button>
                  <Button type="button" disabled={!!busy} onClick={() => { setExports(previous => ({ ...previous, [connecting]: "" })); setConnecting(null); }}>Cancel</Button>
                </div>
                {message && <p role="status">{message}</p>}
              </form>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
