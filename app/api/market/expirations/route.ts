import { NextRequest, NextResponse } from "next/server";
import { sanitizeTicker } from "@/lib/types/options";
import { fetchAndCacheOptionsData } from "@/lib/market/cache";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawTicker = searchParams.get("ticker");

  if (!rawTicker) {
    return NextResponse.json(
      { error: "Missing required parameter: ticker" },
      { status: 400 }
    );
  }

  const ticker = sanitizeTicker(rawTicker);
  if (!ticker) {
    return NextResponse.json(
      { error: "Invalid ticker format. Must be 1-5 letters (e.g., AAPL, NVDA)" },
      { status: 400 }
    );
  }

  try {
    // Fetch from sidecar (with cache)
    const fullData = await fetchAndCacheOptionsData(ticker);

    if (fullData.error) {
      return NextResponse.json(fullData, { status: 404 });
    }

    // Extract unique expiration dates from contracts
    const expirationSet = new Set<string>();
    if (fullData.contracts && Array.isArray(fullData.contracts)) {
      for (const contract of fullData.contracts) {
        if (contract.expiration) {
          expirationSet.add(contract.expiration);
        }
      }
    }
    const expirationDates = Array.from(expirationSet).sort();

    // Return only expirations + price info (no contracts)
    const response = {
      ticker: fullData.ticker,
      provider: fullData.provider,
      timestamp: fullData.timestamp,
      underlying_price: fullData.underlying_price,
      expiration_dates: expirationDates,
      total_dates: expirationDates.length,
      error: null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Expirations API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
