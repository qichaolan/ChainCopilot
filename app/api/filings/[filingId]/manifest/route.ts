/**
 * GET /api/filings/[filingId]/manifest
 *
 * Get filing manifest (small metadata for UI/Copilot context)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFilingManifest } from "@/lib/sec/filings";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filingId: string }> }
) {
  try {
    const { filingId } = await params;

    const manifest = await getFilingManifest(filingId);
    if (!manifest) {
      return NextResponse.json(
        { error: `Filing not found: ${filingId}` },
        { status: 404 }
      );
    }

    return NextResponse.json(manifest);
  } catch (error) {
    console.error("Error in /api/filings/[filingId]/manifest:", error);
    return NextResponse.json(
      { error: "Failed to fetch manifest" },
      { status: 500 }
    );
  }
}
