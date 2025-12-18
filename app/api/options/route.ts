import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  type RawOptionsContract,
  type OptionsChainResult,
  type ExpirationDatesResult,
  isValidTicker,
  isValidExpirationDate,
  sanitizeTicker,
} from "@/lib/types/options";

// Re-export types for backward compatibility
export type { RawOptionsContract as OptionsContract, OptionsChainResult, ExpirationDatesResult };

// Python service URL - use sidecar in production, localhost in development
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

// In-memory cache with TTL (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: string; timestamp: number }>();

function getCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: string): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Fetch options data from the Python FastAPI service.
 * Falls back to spawning Python script if service is unavailable.
 */
async function fetchFromPythonService(
  ticker: string,
  expiration?: string,
  all?: boolean
): Promise<string> {
  const params = new URLSearchParams({ ticker });

  if (all) {
    params.set("all", "true");
  } else if (expiration) {
    params.set("expiration", expiration);
  } else {
    params.set("include_first", "true");
  }

  const url = `${PYTHON_SERVICE_URL}/options?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
    // 90 second timeout for slow API calls
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.text();
}

/**
 * Fallback: spawn Python script directly (slower, for development/debugging).
 */
function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const projectRoot = process.cwd();
    const venvPython = path.join(projectRoot, ".venv", "bin", "python");
    const scriptPath = path.join(projectRoot, "lib", "openbb", "options_fetcher.py");

    const proc = spawn(venvPython, [scriptPath, "--quiet", ...args]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start Python script: ${err.message}`));
    });
  });
}

/**
 * Get options data - tries HTTP service first, falls back to spawn.
 */
async function getOptionsData(
  ticker: string,
  expiration?: string,
  all?: boolean
): Promise<string> {
  // Try the FastAPI service first (fast path)
  try {
    return await fetchFromPythonService(ticker, expiration, all);
  } catch (serviceError) {
    console.warn("Python service unavailable, falling back to spawn:", serviceError);
  }

  // Fallback to spawning Python script (slow path)
  const args = [ticker];
  if (all) {
    args.push("--all");
  } else if (expiration) {
    args.push(expiration);
  } else {
    args.push("--include-first");
  }

  return runPythonScript(args);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawTicker = searchParams.get("ticker");
  const expiration = searchParams.get("expiration");
  const all = searchParams.get("all"); // Batch mode for heatmap

  // Validate ticker parameter
  if (!rawTicker) {
    return NextResponse.json(
      { error: "Missing required parameter: ticker" },
      { status: 400 }
    );
  }

  // Sanitize and validate ticker format (1-5 uppercase letters only)
  const ticker = sanitizeTicker(rawTicker);
  if (!ticker) {
    return NextResponse.json(
      { error: "Invalid ticker format. Must be 1-5 letters (e.g., AAPL, NVDA)" },
      { status: 400 }
    );
  }

  // Validate expiration date format if provided
  if (expiration && !isValidExpirationDate(expiration)) {
    return NextResponse.json(
      { error: "Invalid expiration date format. Expected YYYY-MM-DD (e.g., 2024-01-19)" },
      { status: 400 }
    );
  }

  try {
    // Build cache key
    const cacheKey = all === "true"
      ? `${ticker}:--all`
      : expiration
        ? `${ticker}:${expiration}`
        : `${ticker}:--include-first`;

    // Check cache first
    const cached = getCached(cacheKey);
    if (cached) {
      const result = JSON.parse(cached);
      return NextResponse.json(result);
    }

    // Fetch from Python service (or fallback to spawn)
    const output = await getOptionsData(
      ticker,
      expiration || undefined,
      all === "true"
    );
    const result = JSON.parse(output);

    // Cache successful results
    if (!result.error) {
      setCache(cacheKey, output);
    }

    if (result.error) {
      return NextResponse.json(result, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Options API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
