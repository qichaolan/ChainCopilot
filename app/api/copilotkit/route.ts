import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { TavilySearchResults } from "@tavily/core";

// Initialize the Google Gemini adapter
const serviceAdapter = new GoogleGenerativeAIAdapter({
  model: "gemini-2.0-flash",
});

// Initialize Tavily for web search capabilities
const tavily = new TavilySearchResults({
  apiKey: process.env.TAVILY_API_KEY,
});

// Create the CopilotKit runtime with actions
const runtime = new CopilotRuntime({
  actions: [
    {
      name: "searchInternet",
      description:
        "Search the internet for real-time information about stocks, options, market news, and trading strategies",
      parameters: [
        {
          name: "query",
          type: "string",
          description: "The search query",
          required: true,
        },
      ],
      handler: async ({ query }: { query: string }) => {
        const results = await tavily.search({
          query,
          maxResults: 5,
        });
        return results;
      },
    },
    {
      name: "analyzeOptionsStrategy",
      description:
        "Analyze an options trading strategy and provide insights on risk/reward, probability of profit, and key metrics",
      parameters: [
        {
          name: "strategy",
          type: "string",
          description:
            "The strategy type: covered_call, cash_secured_put, credit_spread, debit_spread, iron_condor, straddle, strangle",
          required: true,
        },
        {
          name: "underlyingPrice",
          type: "number",
          description: "Current price of the underlying stock",
          required: true,
        },
        {
          name: "strikePrice",
          type: "number",
          description: "Strike price of the option",
          required: true,
        },
        {
          name: "premium",
          type: "number",
          description: "Premium received or paid",
          required: true,
        },
        {
          name: "daysToExpiration",
          type: "number",
          description: "Days until expiration",
          required: true,
        },
      ],
      handler: async ({
        strategy,
        underlyingPrice,
        strikePrice,
        premium,
        daysToExpiration,
      }: {
        strategy: string;
        underlyingPrice: number;
        strikePrice: number;
        premium: number;
        daysToExpiration: number;
      }) => {
        // Calculate basic strategy metrics
        const moneyness =
          ((strikePrice - underlyingPrice) / underlyingPrice) * 100;
        const annualizedReturn =
          (premium / underlyingPrice) * (365 / daysToExpiration) * 100;

        return {
          strategy,
          metrics: {
            moneyness: `${moneyness.toFixed(2)}%`,
            annualizedReturn: `${annualizedReturn.toFixed(2)}%`,
            maxProfit: premium,
            breakeven:
              strategy.includes("put") || strategy.includes("call")
                ? strikePrice - premium
                : strikePrice + premium,
            daysToExpiration,
          },
          recommendation:
            Math.abs(moneyness) < 5
              ? "Near ATM - Higher premium but more risk"
              : moneyness > 5
                ? "OTM - Lower premium but higher probability of profit"
                : "ITM - Higher premium but lower probability of profit",
        };
      },
    },
  ],
});

export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
