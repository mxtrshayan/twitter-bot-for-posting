import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../../packages/database";
import { token, validToken } from "../../../../../packages/shared/security";
export const dynamic = "force-dynamic";
const html = (body: string) =>
  new NextResponse(
    `<!doctype html><html><head><title>Local automation target</title></head><body>${body}</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function GET(req: NextRequest) {
  if (process.env.MOCK_ENABLED !== "true")
    return new NextResponse(null, { status: 404 });
  const path = req.nextUrl.pathname;
  if (path.endsWith("/login"))
    return html(
      '<h1>Local test login</h1><form method="post"><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>',
    );
  if (!validToken(req.cookies.get("mock-session")?.value || "", "mock"))
    return new NextResponse(null, {
      status: 307,
      headers: { Location: "/mock/login" },
    });
  if (path.endsWith("/create-post"))
    return html(
      '<h1>Create post</h1><form method="post"><label>Post content<textarea name="content"></textarea></label><button>Publish</button></form>',
    );
  if (path.endsWith("/posts"))
    return html(
      `<h1>Posts</h1>${(await db.mockPost.findMany({ orderBy: { createdAt: "desc" } })).map((p) => `<article><p>${escape(p.content)}</p></article>`).join("")}`,
    );
  return html(
    '<h1>Authenticated dashboard</h1><a href="/mock/create-post">Create post</a>',
  );
}
export async function POST(req: NextRequest) {
  if (process.env.MOCK_ENABLED !== "true")
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  if (req.nextUrl.pathname.endsWith("/login")) {
    if (
      form.get("email") !== "test@example.com" ||
      form.get("password") !== "test-password"
    )
      return html("<h1>Invalid credentials</h1>");
    const response = new NextResponse(null, {
      status: 303,
      headers: { Location: "/mock/dashboard" },
    });
    response.cookies.set("mock-session", token("mock"), {
      httpOnly: true,
      sameSite: "lax",
      path: "/mock",
    });
    return response;
  }
  if (!validToken(req.cookies.get("mock-session")?.value || "", "mock"))
    return new NextResponse(null, { status: 401 });
  const content = String(form.get("content") || "").trim();
  if (!content || content.length > 5000)
    return new NextResponse(null, { status: 400 });
  await db.mockPost.create({ data: { content } });
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/mock/posts" },
  });
}
