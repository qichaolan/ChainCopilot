import { spawn } from "child_process";
import path from "path";

// Python service URL - use sidecar in production, localhost in development
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

// Shared cache for full options data
// TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: any;
  timestamp: number;
}

// Global cache shared across endpoints via module scope
declare global {
  var optionsCache: Map<string, CacheEntry> | undefined;
}

if (!global.optionsCache) {
  global.optionsCache = new Map();
}

const cache = global.optionsCache;

export function getCachedData(ticker: string): any | null {
  const entry = cache.get(ticker.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(ticker.toUpperCase());
    return null;
  }
  return entry.data;
}

export function setCachedData(ticker: string, data: any): void {
  cache.set(ticker.toUpperCase(), { data, timestamp: Date.now() });
}

export function runPythonScript(args: string[]): Promise<string> {
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
 * Fetch options data from Python FastAPI sidecar (fast path)
 */
async function fetchFromPythonService(ticker: string, all: boolean = false): Promise<string> {
  const params = new URLSearchParams({ ticker });
  if (all) {
    params.set("all", "true");
  }

  const url = `${PYTHON_SERVICE_URL}/options?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(90000), // 90 second timeout
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.text();
}

// Fetch and cache full options data for a ticker
export async function fetchAndCacheOptionsData(ticker: string): Promise<any> {
  // Check cache first
  let fullData = getCachedData(ticker);

  if (!fullData) {
    // Try FastAPI sidecar first (fast path)
    try {
      const output = await fetchFromPythonService(ticker, true);
      fullData = JSON.parse(output);
    } catch (serviceError) {
      console.warn("Python service unavailable, falling back to spawn:", serviceError);
      // Fallback to spawning Python script (slow path)
      const output = await runPythonScript([ticker, "--all"]);
      fullData = JSON.parse(output);
    }

    if (!fullData.error) {
      setCachedData(ticker, fullData);
    }
  }

  return fullData;
}
