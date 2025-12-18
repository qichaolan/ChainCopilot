import { NextRequest, NextResponse } from "next/server";

/**
 * Strategy Builder API Route
 *
 * Proxies requests to the Python Strategy Builder agent.
 */

const STRATEGY_AGENT_URL = process.env.STRATEGY_AGENT_URL || "http://localhost:8001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log("[Strategy API] Request:", body.action, body.ticker || body.expiration || body.strategy);

    const response = await fetch(`${STRATEGY_AGENT_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      console.error("[Strategy API] Agent error:", error);
      return NextResponse.json(
        { success: false, error: error.detail || `HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log("[Strategy API] Response stage:", result.stage, "success:", result.success);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Strategy API] Error:", error);

    // Check if it's a connection error (agent not running)
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return NextResponse.json(
        {
          success: false,
          error: "Strategy agent not available. Please ensure the Python agent is running on port 8001.",
          stage: "ticker",
          data: {},
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stage: "ticker",
        data: {},
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Health check - verify agent is running
  try {
    const response = await fetch(`${STRATEGY_AGENT_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: "Agent returned non-200" },
        { status: 503 }
      );
    }

    const health = await response.json();
    return NextResponse.json({ status: "healthy", agent: health });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", error: "Agent not reachable" },
      { status: 503 }
    );
  }
}
