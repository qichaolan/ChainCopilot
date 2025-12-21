import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt, getFundamentalPrompt } from "@/lib/ai/promptLoader";

/**
 * CopilotKit Runtime API Route
 *
 * This endpoint handles AI chat requests from CopilotKit components.
 * Uses Google Generative AI (Gemini) as the LLM provider.
 *
 * Dynamically switches between prompts based on context:
 * - Options trading prompt (default)
 * - Fundamental analysis prompt (when SEC filing context is present)
 *
 * NOTE: We inject system prompts server-side because useCopilotAdditionalInstructions
 * doesn't properly forward to the Google adapter.
 */

// Check for API key at startup
if (!process.env.GOOGLE_API_KEY) {
  console.error("WARNING: GOOGLE_API_KEY is not set in environment variables");
}

// Load prompts from files (server-side)
let optionsPrompt: string;
let fundamentalPrompt: string;

try {
  optionsPrompt = getSystemPrompt();
  console.log("[CopilotKit] Options prompt loaded from file");
} catch (error) {
  console.warn("[CopilotKit] Failed to load options prompt from file, using fallback");
  optionsPrompt = `You are ChainCopilot, an expert AI assistant for stock options trading analysis.

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

try {
  fundamentalPrompt = getFundamentalPrompt();
  console.log("[CopilotKit] Fundamental prompt loaded from file");
} catch (error) {
  console.warn("[CopilotKit] Failed to load fundamental prompt from file, using fallback");
  fundamentalPrompt = `You are a financial analyst specializing in SEC filings (10-K, 10-Q).
Your role is pure analysis: extract data, compute ratios, identify patterns, and provide grounded insights with citations.

Guidelines:
- Evidence-based only: Use data from provided content only
- No speculation or external inference
- Scale all values to USD millions (except per-share data)
- Round ratios to two decimals
- Cite section sources for all findings
- Flag anomalies like margin compression, rising leverage, earnings quality issues`;
}

/**
 * Detect if request contains SEC filing context
 */
function hasFilingContext(body: Record<string, unknown>): boolean {
  const context = body.context as Array<{ description?: string; value?: string }> | undefined;
  if (!Array.isArray(context)) return false;

  return context.some((c) => {
    const desc = c.description?.toLowerCase() || "";
    const val = c.value?.toLowerCase() || "";
    return (
      desc.includes("sec filing") ||
      desc.includes("current_section_content") ||
      val.includes("activefiling") ||
      val.includes("form_type")
    );
  });
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

    // Detect context and select appropriate prompt
    const isFilingContext = hasFilingContext(body);
    const systemPrompt = isFilingContext ? fundamentalPrompt : optionsPrompt;

    // Log for debugging
    console.log("[CopilotKit] Context type:", isFilingContext ? "SEC Filing" : "Options");
    console.log("[CopilotKit] Original messages count:", body.messages?.length || 0);
    console.log("[CopilotKit] Actions in request:", body.actions?.map((a: { name: string }) => a.name) || 'none');

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
        (firstMsg?.content && (
          firstMsg.content.includes("ChainCopilot") ||
          firstMsg.content.includes("SEC filing") ||
          firstMsg.content.includes("financial analyst")
        ));

      if (!hasSystemMsg) {
        // Prepend system message
        body.messages.unshift({
          id: `system-${Date.now()}`,
          role: "system",
          content: systemPrompt,
        });
        console.log("[CopilotKit] Injected system message for:", isFilingContext ? "fundamental" : "options");
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
