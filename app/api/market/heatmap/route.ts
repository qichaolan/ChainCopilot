import { NextRequest, NextResponse } from "next/server";
import { sanitizeTicker, isValidExpirationDate } from "@/lib/types/options";
import { fetchAndCacheOptionsData } from "@/lib/market/cache";

interface HeatmapRequest {
  ticker: string;
  expirations?: string[]; // Optional: specific expirations to include
}

export async function POST(request: NextRequest) {
  let body: HeatmapRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { ticker: rawTicker, expirations: requestedExpirations } = body;

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

  // Validate requested expirations if provided
  if (requestedExpirations && requestedExpirations.length > 0) {
    for (const exp of requestedExpirations) {
      if (!isValidExpirationDate(exp)) {
        return NextResponse.json(
          { error: `Invalid expiration date format: ${exp}. Expected YYYY-MM-DD` },
          { status: 400 }
        );
      }
    }
  }

  try {
    // Fetch from sidecar (with cache)
    const fullData = await fetchAndCacheOptionsData(ticker);

    if (fullData.error) {
      return NextResponse.json(fullData, { status: 404 });
    }

    let contracts = fullData.contracts || [];

    // Filter by requested expirations if specified
    if (requestedExpirations && requestedExpirations.length > 0) {
      const expSet = new Set(requestedExpirations);
      contracts = contracts.filter((c: any) => expSet.has(c.expiration));
    }

    // Get unique expirations from filtered contracts
    const expirationSet = new Set<string>();
    for (const contract of contracts) {
      if (contract.expiration) {
        expirationSet.add(contract.expiration);
      }
    }

    const response = {
      ticker: fullData.ticker,
      provider: fullData.provider,
      timestamp: fullData.timestamp,
      underlying_price: fullData.underlying_price,
      expiration_dates: Array.from(expirationSet).sort(),
      contracts: contracts,
      total_contracts: contracts.length,
      error: null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Heatmap API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
