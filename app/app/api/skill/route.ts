import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent");

  const filePath = join(process.cwd(), "public", "skill.md");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return new NextResponse("Skill not found", { status: 404 });
  }

  // If loaded with ?agent=X (via dashboard/add flow), pre-fill the agentId
  // and mark the agent as already registered so it skips first-time setup.
  if (agentId) {
    content = content
      .replace(/your-agent-id/g, agentId)
      .replace(/your-unique-agent-id/g, agentId)
      .replace(/^---\n/, `---\nagent: ${agentId}\n`);

    content = content.replace(
      "**If you are already registered** (you have an `agentId` from a previous session), skip this and go straight to Step 1.",
      `**You are already registered** as \`${agentId}\`. Skip the setup above and go straight to Step 1.`
    );
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
