# ChainCopilot

An AI-powered stock options analysis tool built with CopilotKit and Google Gemini. It provides real-time options chain analysis with intelligent AI insights for various trading strategies.

## Live Demo

[optchain.app](https://optchain.app)

## Features

- Real-time options chain data display
- AI-powered analysis with Google Gemini
- Greeks visualization (Delta, Gamma, Theta, Vega, IV)
- Strategy recommendations and risk analysis
- Mobile-responsive design (iOS, Android, Desktop)
- Dark mode support

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **AI Integration**: CopilotKit, Google Gemini
- **Styling**: Tailwind CSS
- **Search**: Tavily API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/ChainCopilot.git
   cd ChainCopilot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file with your API keys:
   ```bash
   cp .env.example .env.local
   ```

4. Add your API keys to `.env.local`:
   - Get a Google Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Get a Tavily API key from [Tavily](https://tavily.com/)

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
ChainCopilot/
├── app/
│   ├── api/copilotkit/    # CopilotKit backend route
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Main page
│   └── globals.css        # Global styles
├── components/
│   ├── Header.tsx         # Navigation header
│   ├── Footer.tsx         # Page footer
│   └── OptionsChainDashboard.tsx  # Main dashboard
├── lib/
│   └── utils.ts           # Utility functions
└── ...config files
```

## AI Features

The CopilotKit integration provides:

- **Chat Interface**: Ask questions about options strategies, Greeks, market analysis
- **Web Search**: Real-time market news and information via Tavily
- **Strategy Analysis**: Analyze covered calls, spreads, iron condors, and more

## Contact

info@optchain.app

## Disclaimer

Options trading involves substantial risk and is not suitable for all investors. This tool is for educational and informational purposes only. Not financial advice.
