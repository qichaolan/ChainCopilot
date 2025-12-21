import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { OptionsChainProvider } from "@/components/dashboard/options-chain/context/OptionsChainContext";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChainCopilot - AI-Powered Options Analysis",
  description:
    "Real-time options chain analysis with intelligent AI insights for various trading strategies",
  keywords: [
    "options trading",
    "stock options",
    "options chain",
    "AI trading",
    "options analysis",
  ],
  authors: [{ name: "ChainCopilot", url: "https://optchain.app" }],
  openGraph: {
    title: "ChainCopilot - AI-Powered Options Analysis",
    description: "Real-time options chain analysis with intelligent AI insights",
    url: "https://optchain.app",
    siteName: "ChainCopilot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ChainCopilot - AI-Powered Options Analysis",
    description: "Real-time options chain analysis with intelligent AI insights",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen`}
      >
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          showDevConsole={false}
        >
          <OptionsChainProvider>
            {children}
          </OptionsChainProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
