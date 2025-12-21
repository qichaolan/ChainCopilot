/**
 * POST /api/filings/[filingId]/ask
 *
 * AI analysis endpoint - answers questions about the filing using RAG
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getRAGContext,
  getFilingManifest,
  getFilingSectionIndex,
} from "@/lib/sec/filings";
import { AskFilingResult, AskFilingCitation } from "@/lib/sec/types";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

interface AskRequest {
  question: string;
  scope?: "current_section" | "selected_sections" | "entire_filing";
  sectionIds?: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ filingId: string }> }
) {
  try {
    const { filingId } = await params;
    const body: AskRequest = await req.json();
    const { question, scope = "entire_filing", sectionIds } = body;

    if (!question) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    // Get filing manifest for context
    const manifest = await getFilingManifest(filingId);
    if (!manifest) {
      return NextResponse.json(
        { error: `Filing not found: ${filingId}` },
        { status: 404 }
      );
    }

    // Get section index for labels
    const sectionIndex = await getFilingSectionIndex(filingId);
    const sectionLabels = new Map(
      sectionIndex?.sections.map((s) => [s.id, s.label]) || []
    );

    // Get relevant chunks using RAG
    const { chunks, sections } = await getRAGContext(
      filingId,
      question,
      scope,
      sectionIds
    );

    if (chunks.length === 0) {
      return NextResponse.json({
        filing_id: filingId,
        question,
        answer: "I couldn't find relevant information in the filing to answer this question.",
        citations: [],
        confidence: 0,
        followups: ["Try rephrasing your question", "Search for specific terms"],
      });
    }

    // Build context for the LLM
    const contextText = chunks
      .map((c) => `[${sectionLabels.get(c.section_id) || c.section_id}]\n${c.text}`)
      .join("\n\n---\n\n");

    // Build the prompt
    const prompt = `You are an expert financial analyst helping a trader understand SEC filings.

FILING CONTEXT:
- Company: ${manifest.company_name} (${manifest.ticker})
- Form Type: ${manifest.form_type}
- Filed: ${manifest.filed_at}
- Report Period: ${manifest.report_period || "N/A"}

RELEVANT EXCERPTS FROM THE FILING:
${contextText}

USER QUESTION: ${question}

INSTRUCTIONS:
1. Answer the question based ONLY on the provided excerpts
2. Be specific and cite which section the information comes from
3. If the excerpts don't contain enough information, say so
4. Format your response clearly with bullet points for key findings
5. At the end, suggest 2-3 follow-up questions the user might want to ask

RESPONSE FORMAT:
Answer: [Your detailed answer here]

Sources: [List the section IDs you referenced]

Follow-up questions:
- [Question 1]
- [Question 2]
- [Question 3]`;

    // Call Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Parse the response
    const answerMatch = response.match(/Answer:\s*([\s\S]*?)(?=\n\nSources:|Sources:|$)/i);
    const sourcesMatch = response.match(/Sources?:\s*([\s\S]*?)(?=\n\nFollow-up|Follow-up|$)/i);
    const followupsMatch = response.match(/Follow-up questions?:\s*([\s\S]*?)$/i);

    const answer = answerMatch ? answerMatch[1].trim() : response;

    // Extract citations from sources and chunks used
    const citations: AskFilingCitation[] = [];
    const usedSectionIds = new Set<string>();

    // Parse source references
    if (sourcesMatch) {
      const sourceText = sourcesMatch[1];
      for (const section of sections) {
        if (sourceText.toLowerCase().includes(section.id.toLowerCase()) ||
            sourceText.toLowerCase().includes(section.label.toLowerCase())) {
          usedSectionIds.add(section.id);
        }
      }
    }

    // Add citations from used chunks
    for (const chunk of chunks) {
      if (usedSectionIds.has(chunk.section_id) || usedSectionIds.size === 0) {
        // Only add first chunk per section as citation
        if (!citations.some((c) => c.section_id === chunk.section_id)) {
          citations.push({
            section_id: chunk.section_id,
            section_label: sectionLabels.get(chunk.section_id) || chunk.section_id,
            chunk_id: chunk.id,
            snippet: chunk.text.slice(0, 200) + "...",
          });
        }
      }
    }

    // Parse follow-up questions
    const followups: string[] = [];
    if (followupsMatch) {
      const lines = followupsMatch[1].split("\n");
      for (const line of lines) {
        const cleaned = line.replace(/^[-•*]\s*/, "").trim();
        if (cleaned && cleaned.length > 5) {
          followups.push(cleaned);
        }
      }
    }

    // Calculate confidence based on context quality
    const confidence = Math.min(
      1,
      (chunks.length / 10) * 0.5 + (citations.length > 0 ? 0.3 : 0) + 0.2
    );

    const responseData: AskFilingResult = {
      filing_id: filingId,
      question,
      answer,
      citations: citations.slice(0, 5),
      confidence,
      followups: followups.slice(0, 3),
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Error in /api/filings/[filingId]/ask:", error);
    return NextResponse.json(
      { error: "Failed to analyze filing" },
      { status: 500 }
    );
  }
}
