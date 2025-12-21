/**
 * POST /api/filings/chat
 *
 * Proxy endpoint that forwards chat requests to the Python Fundamental Agent.
 * This enables the architecture:
 *   FilingChatPanel → /api/filings/chat → Python Agent → Tools
 */

import { NextRequest, NextResponse } from "next/server";

// Python agent URL - defaults to localhost for development
const AGENT_URL = process.env.FUNDAMENTAL_AGENT_URL || "http://localhost:8002";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  filingId?: string;
  currentSectionId?: string;
  currentSectionContent?: string;
  thread_id?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();

    console.log("[FilingsChat] Forwarding to Python agent:", {
      filingId: body.filingId,
      messageCount: body.messages?.length,
      currentSectionId: body.currentSectionId,
    });

    // Forward to Python agent's streaming endpoint
    const agentResponse = await fetch(`${AGENT_URL}/v1/filings/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!agentResponse.ok) {
      console.error("[FilingsChat] Agent error:", agentResponse.status);
      return NextResponse.json(
        { error: `Agent error: ${agentResponse.status}` },
        { status: agentResponse.status }
      );
    }

    // Stream the response back
    const headers = new Headers();
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");

    return new Response(agentResponse.body, { headers });
  } catch (error) {
    console.error("[FilingsChat] Error:", error);

    // If agent is not running, fallback to direct API call
    if (error instanceof TypeError && error.message.includes("fetch")) {
      console.log("[FilingsChat] Agent not available, using fallback");
      return NextResponse.json(
        { error: "Fundamental agent not available. Start with: python agents/fundamental_agent/server.py" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Sync chat endpoint - non-streaming version
 */
export async function PUT(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();

    const agentResponse = await fetch(`${AGENT_URL}/v1/filings/chat/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!agentResponse.ok) {
      return NextResponse.json(
        { error: `Agent error: ${agentResponse.status}` },
        { status: agentResponse.status }
      );
    }

    const data = await agentResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[FilingsChat] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
