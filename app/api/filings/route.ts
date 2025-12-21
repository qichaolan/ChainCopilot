/**
 * GET /api/filings
 *
 * List all SEC filings or filter by company/form type
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllFilings, getCompanyFilings, getCompanies } from "@/lib/sec/filings";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker");
    const formType = searchParams.get("formType");

    // If ticker specified, get filings for that company
    if (ticker) {
      const companyFilings = await getCompanyFilings(ticker);
      if (!companyFilings) {
        return NextResponse.json(
          { error: `No filings found for ${ticker}` },
          { status: 404 }
        );
      }

      // Filter by form type if specified
      let filings = companyFilings.filings;
      if (formType) {
        filings = filings.filter(
          (f) => f.formType.toLowerCase() === formType.toLowerCase()
        );
      }

      return NextResponse.json({
        ticker: companyFilings.ticker,
        companyName: companyFilings.companyName,
        filings,
      });
    }

    // Get all filings across all companies
    const filings = await getAllFilings(formType || undefined);

    // Also get list of companies
    const companies = await getCompanies();

    return NextResponse.json({
      companies,
      filings,
      total: filings.length,
    });
  } catch (error) {
    console.error("Error in /api/filings:", error);
    return NextResponse.json(
      { error: "Failed to fetch filings" },
      { status: 500 }
    );
  }
}
