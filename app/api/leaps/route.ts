import { NextRequest, NextResponse } from "next/server";

/**
 * LEAPS Agent API Route
 *
 * Proxies requests to the Python LEAPS CoAgent server.
 * This bypasses CopilotKit SDK issues by making direct HTTP calls.
 */

const LEAPS_COAGENT_URL = process.env.LEAPS_COAGENT_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    console.log("[LEAPS API] Received request:", JSON.stringify(body).slice(0, 200));

    // Forward to Python agent
    const response = await fetch(`${LEAPS_COAGENT_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LEAPS API] Agent error:", errorText);
      return NextResponse.json(
        { error: `Agent error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    // Stream the response if it's SSE
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/event-stream")) {
      // Return streaming response
      return new NextResponse(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Regular JSON response
    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("[LEAPS API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  try {
    const response = await fetch(`${LEAPS_COAGENT_URL}/health`);
    const data = await response.json();
    return NextResponse.json({ status: "ok", agent: data });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: "LEAPS agent not available" },
      { status: 503 }
    );
  }
}
