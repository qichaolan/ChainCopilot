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
    const args = [ticker];

    // Batch mode: get ALL contracts for all expirations (for heatmap)
    if (all === "true") {
      args.push("--all");
    } else if (expiration) {
      args.push(expiration);
    } else {
      // Initial search: include first expiration's contracts to avoid second API call
      args.push("--include-first");
    }

    const output = await runPythonScript(args);
    const result = JSON.parse(output);

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
