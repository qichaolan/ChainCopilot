/**
 * GET /api/filings/[filingId]/section/[sectionId]
 *
 * Get section content with text and optional HTML
 */

import { NextRequest, NextResponse } from "next/server";
import { getFilingSection } from "@/lib/sec/filings";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filingId: string; sectionId: string }> }
) {
  try {
    const { filingId, sectionId } = await params;
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") as "text" | "html") || "text";

    const section = await getFilingSection(filingId, sectionId, format);
    if (!section) {
      return NextResponse.json(
        { error: `Section not found: ${sectionId} in ${filingId}` },
        { status: 404 }
      );
    }

    return NextResponse.json(section);
  } catch (error) {
    console.error("Error in /api/filings/[filingId]/section/[sectionId]:", error);
    return NextResponse.json(
      { error: "Failed to fetch section" },
      { status: 500 }
    );
  }
}
