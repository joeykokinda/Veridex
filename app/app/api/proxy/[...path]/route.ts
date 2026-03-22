import { NextRequest, NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || "http://localhost:3001";

async function proxy(request: NextRequest, path: string[]) {
  const url = new URL(request.url);
  const targetUrl = `${ORCHESTRATOR_URL}/${path.join("/")}${url.search}`;

  // SSE passthrough — pipe the stream directly, never buffer
  const acceptHeader = request.headers.get("accept") || "";
  if (acceptHeader.includes("text/event-stream")) {
    try {
      const upstream = await fetch(targetUrl, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "text/event-stream" },
      });
      // Return the raw readable stream with correct SSE headers
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch {
      return new Response("data: {\"error\":\"Orchestrator unreachable\"}\n\n", {
        status: 503,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
  }

  // Normal JSON proxy
  try {
    const init: RequestInit = {
      method: request.method,
      cache: "no-store",
    };
    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      const body = await request.text();
      init.body = body || undefined;
      init.headers = { "Content-Type": "application/json" };
    }
    const res = await fetch(targetUrl, init);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Orchestrator unreachable", url: targetUrl },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}
