/**
 * GET /api/filings/[filingId]/search
 *
 * Search within a filing and return matching snippets with citations
 */

import { NextRequest, NextResponse } from "next/server";
import { searchFiling, getFilingSectionIndex } from "@/lib/sec/filings";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filingId: string }> }
) {
  try {
    const { filingId } = await params;
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    const topK = parseInt(searchParams.get("topK") || "5", 10);

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    const result = await searchFiling(filingId, query, topK);

    // Enrich with section labels
    const sectionIndex = await getFilingSectionIndex(filingId);
    const sectionLabels = new Map(
      sectionIndex?.sections.map((s) => [s.id, s.label]) || []
    );

    const enrichedMatches = result.matches.map((m) => ({
      ...m,
      section_label: sectionLabels.get(m.section_id) || m.section_id,
    }));

    return NextResponse.json({
      ...result,
      matches: enrichedMatches,
    });
  } catch (error) {
    console.error("Error in /api/filings/[filingId]/search:", error);
    return NextResponse.json(
      { error: "Failed to search filing" },
      { status: 500 }
    );
  }
}
