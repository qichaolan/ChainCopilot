import { NextRequest, NextResponse } from "next/server";
import { sanitizeTicker, isValidExpirationDate } from "@/lib/types/options";
import { fetchAndCacheOptionsData } from "@/lib/market/cache";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawTicker = searchParams.get("ticker");
  const expiration = searchParams.get("exp");

  if (!rawTicker) {
    return NextResponse.json(
      { error: "Missing required parameter: ticker" },
      { status: 400 }
    );
  }

  if (!expiration) {
    return NextResponse.json(
      { error: "Missing required parameter: exp (expiration date)" },
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

  if (!isValidExpirationDate(expiration)) {
    return NextResponse.json(
      { error: "Invalid expiration date format. Expected YYYY-MM-DD (e.g., 2024-01-19)" },
      { status: 400 }
    );
  }

  try {
    // Fetch from sidecar (with cache)
    const fullData = await fetchAndCacheOptionsData(ticker);

    if (fullData.error) {
      return NextResponse.json(fullData, { status: 404 });
    }

    // Filter contracts by expiration date
    const contracts = fullData.contracts || [];
    const filteredContracts = contracts.filter(
      (c: any) => c.expiration === expiration
    );

    // Sort by strike, then by option type
    filteredContracts.sort((a: any, b: any) => {
      const strikeA = a.strike ?? Infinity;
      const strikeB = b.strike ?? Infinity;
      if (strikeA !== strikeB) return strikeA - strikeB;
      return (a.option_type || "").localeCompare(b.option_type || "");
    });

    const response = {
      ticker: fullData.ticker,
      provider: fullData.provider,
      timestamp: fullData.timestamp,
      expiration_date: expiration,
      underlying_price: fullData.underlying_price,
      contracts: filteredContracts,
      total_contracts: filteredContracts.length,
      error: filteredContracts.length === 0
        ? `No contracts found for expiration ${expiration}`
        : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Chain API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
