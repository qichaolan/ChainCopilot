import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/ai/promptLoader";

/**
 * CopilotKit Runtime API Route
 *
 * This endpoint handles AI chat requests from CopilotKit components.
 * Uses Google Generative AI (Gemini) as the LLM provider.
 *
 * NOTE: We inject system prompts server-side because useCopilotAdditionalInstructions
 * doesn't properly forward to the Google adapter.
 */

// Check for API key at startup
if (!process.env.GOOGLE_API_KEY) {
  console.error("WARNING: GOOGLE_API_KEY is not set in environment variables");
}

// Load system prompt from file (server-side)
let systemPrompt: string;
try {
  systemPrompt = getSystemPrompt();
  console.log("[CopilotKit] System prompt loaded from file");
} catch (error) {
  console.warn("[CopilotKit] Failed to load system prompt from file, using fallback");
  systemPrompt = `You are ChainCopilot, an expert AI assistant for stock options trading analysis.

Your expertise includes:
- Options chain data and Greeks (Delta, Gamma, Theta, Vega, IV)
- Trading strategies (covered calls, cash-secured puts, spreads, iron condors, straddles)
- Risk/reward analysis and probability of profit
- Market sentiment and unusual options activity
- Entry/exit timing and position sizing

Guidelines:
- Be concise and data-driven
- Always emphasize risk management
- Format numbers clearly and use bullet points for key metrics
- Respond conversationally to greetings and general questions
- When given options data in context, analyze it specifically`;
}

// Initialize the Gemini adapter
// DO NOT CHANGE: gemini-2.5-flash-lite is the intended model, should not modify this.
const serviceAdapter = new GoogleGenerativeAIAdapter({
  model: "gemini-2.5-flash-lite",
  apiVersion: "v1",
});

// Create the CopilotKit runtime
const runtime = new CopilotRuntime();

// Export the handler for Next.js App Router
export const POST = async (req: NextRequest) => {
  console.log("=== CopilotKit API Request ===");

  // Check API key before processing
  if (!process.env.GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY is missing");
    return NextResponse.json(
      { error: "API key not configured. Set GOOGLE_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    // Clone and modify the request body to inject system prompt
    const body = await req.json();

    // Log original request for debugging
    console.log("[CopilotKit] Original messages count:", body.messages?.length || 0);

    // Inject system prompt into context as high-priority instruction
    if (!body.context) {
      body.context = [];
    }

    // Add system prompt as the FIRST context item with clear instruction framing
    body.context.unshift({
      description: "SYSTEM INSTRUCTIONS - You MUST follow these instructions for every response",
      value: JSON.stringify(systemPrompt),
    });

    // Also inject as a system message at the start of messages array
    if (body.messages && Array.isArray(body.messages)) {
      // Check if first message is already a system instruction
      const firstMsg = body.messages[0];
      const hasSystemMsg = firstMsg?.role === "system" ||
        (firstMsg?.content && firstMsg.content.includes("ChainCopilot"));

      if (!hasSystemMsg) {
        // Prepend system message
        body.messages.unshift({
          id: `system-${Date.now()}`,
          role: "system",
          content: systemPrompt,
        });
        console.log("[CopilotKit] Injected system message");
      }
    }

    // Create modified request
    const modifiedReq = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(body),
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
    });

    const response = await handleRequest(modifiedReq);
    console.log("Response status:", response.status);
    return response;
  } catch (error) {
    console.error("CopilotKit API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
};
