/**
 * Options Chain Analysis API Route
 *
 * Server-side endpoint that uses the prompt loader to build
 * analysis prompts from markdown files and call Gemini.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { aiService } from '@/services/ai';
import { getChainAnalysisPrompt } from '@/lib/ai/promptLoader';

// Validate API key at module load time
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Lazy initialization of Gemini client (only created when actually needed)
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY environment variable is not configured');
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
  }
  return genAI;
}

// Types for the analysis request
interface AnalyzeRequest {
  symbol: string;
  expiration: string;
  underlyingPrice: number;
  optionMetadata: {
    strike: number;
    type: 'call' | 'put';
    bid: number;
    ask: number;
    last: number;
    volume: number;
    openInterest: number;
    impliedVolatility: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    dte: number;
    [key: string]: unknown;
  };
}

export async function POST(req: NextRequest) {
  // Check API key early
  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  try {
    const body: AnalyzeRequest = await req.json();
    const { symbol, expiration, underlyingPrice, optionMetadata } = body;

    // Validate required fields
    if (!symbol || !expiration || !underlyingPrice || !optionMetadata) {
      return NextResponse.json(
        { error: 'Missing required fields: symbol, expiration, underlyingPrice, optionMetadata' },
        { status: 400 }
      );
    }

    // Load the chain analysis prompt from file
    const basePrompt = getChainAnalysisPrompt();

    // Build the full prompt with context and metadata
    const fullPrompt = aiService.buildPrompt({
      base: basePrompt,
      context: `Analyzing ${symbol} ${optionMetadata.type.toUpperCase()} option for ${expiration} expiration.\nCurrent underlying price: $${underlyingPrice.toFixed(2)}\nDays to expiration: ${optionMetadata.dte}`,
      metadata: optionMetadata,
    });

    // Call Gemini
    // DO NOT CHANGE: gemini-2.5-flash-lite is the intended model
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = response.text();

    // Try to parse as JSON (the prompt asks for JSON output)
    try {
      const analysis = JSON.parse(text);
      return NextResponse.json({ success: true, analysis });
    } catch {
      // If not valid JSON, return raw text
      return NextResponse.json({ success: true, analysis: { raw: text } });
    }
  } catch (error) {
    console.error('Analyze API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
