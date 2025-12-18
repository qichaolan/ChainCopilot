'use client';

/**
 * AI Strategy Builder Page
 *
 * Dual-panel layout following CopilotKit state-machine pattern:
 * - Left (60%): Workspace with candidates, options chain, simulations
 * - Right (40%): Copilot with stage controls and HITL interactions
 */

import { CopilotKit } from '@copilotkit/react-core';
import { StrategyBuilderProvider } from '@/lib/strategy';
import { WorkspacePanel, CopilotPanel } from '@/components/strategy';
import { Header } from '@/components/layout/Header';

function StrategyBuilderContent() {
  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Panel - Workspace (60%) */}
      <div className="w-3/5 overflow-hidden">
        <WorkspacePanel />
      </div>

      {/* Right Panel - Copilot (40%) */}
      <div className="w-2/5 overflow-hidden">
        <CopilotPanel />
      </div>
    </div>
  );
}

export default function StrategiesPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <StrategyBuilderProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
          <Header />
          <StrategyBuilderContent />
        </div>
      </StrategyBuilderProvider>
    </CopilotKit>
  );
}
