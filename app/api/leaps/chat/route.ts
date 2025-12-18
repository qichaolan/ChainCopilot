import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * LEAPS Follow-up Chat API
 *
 * Handles follow-up questions in the LEAPS Builder panel.
 * Uses Google Gemini to answer questions with LEAPS context.
 */

const LEAPS_CHAT_PROMPT = `You are a LEAPS (Long-term Equity Anticipation Securities) options expert assistant.
You are helping a trader analyze LEAPS options positions.

Your expertise includes:
- LEAPS options strategy (buying calls/puts with 1-2 year expirations)
- Delta, theta, gamma, vega analysis for long-dated options
- Position sizing and risk management for LEAPS
- IV rank and volatility considerations
- Entry timing and strike selection

Guidelines:
- Be concise and specific to the context provided
- Focus on actionable insights
- Explain complex concepts simply
- Always emphasize risk considerations
- Use specific numbers from the context when available

Current Analysis Context:
{context}

Answer the following question about this LEAPS analysis:`;

export async function POST(req: NextRequest) {
  try {
    const { question, context } = await req.json();

    if (!question) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Google API key not configured" },
        { status: 500 }
      );
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

    // Build the prompt with context
    const contextStr = context || "No specific context provided";
    const fullPrompt = LEAPS_CHAT_PROMPT.replace("{context}", contextStr) + "\n\n" + question;

    console.log("[LEAPS Chat] Processing question:", question.slice(0, 100));

    // Generate response
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({
      answer: text,
      model: "gemini-2.0-flash-lite"
    });

  } catch (error) {
    console.error("[LEAPS Chat] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate response" },
      { status: 500 }
    );
  }
}
