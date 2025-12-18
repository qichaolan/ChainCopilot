'use client';

/**
 * LEAPSStepChips - Fixed step indicator chips for LEAPS workflow
 *
 * Shows: Filter → Rank → Compare/Simulate → Risk Scan → Decide
 * Highlights active chip based on current workflow step
 */

import React from 'react';
import { Filter, Medal, LineChart, Shield, CheckCircle, Loader2 } from 'lucide-react';
import { WorkflowStep, useLEAPSFlow } from './LEAPSFlowContext';

interface StepConfig {
  id: WorkflowStep;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepConfig[] = [
  { id: 'filter', label: 'Filter', icon: Filter },
  { id: 'rank', label: 'Rank', icon: Medal },
  { id: 'simulate', label: 'Simulate', icon: LineChart },
  { id: 'risk_scan', label: 'Risk Scan', icon: Shield },
  { id: 'decide', label: 'Decide', icon: CheckCircle },
];

function getStepStatus(
  stepId: WorkflowStep,
  currentStep: WorkflowStep,
  completedSteps: WorkflowStep[],
  isProcessing: boolean
): 'completed' | 'active' | 'pending' {
  if (completedSteps.includes(stepId)) return 'completed';
  if (stepId === currentStep && isProcessing) return 'active';
  if (stepId === currentStep) return 'active';
  return 'pending';
}

interface StepChipProps {
  step: StepConfig;
  status: 'completed' | 'active' | 'pending';
  isProcessing: boolean;
}

function StepChip({ step, status, isProcessing }: StepChipProps) {
  const Icon = step.icon;

  const baseClasses = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200';

  const statusClasses = {
    completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800',
    active: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700 shadow-sm',
    pending: 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-slate-600',
  };

  return (
    <div className={`${baseClasses} ${statusClasses[status]}`}>
      {status === 'active' && isProcessing ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : status === 'completed' ? (
        <CheckCircle className="w-3.5 h-3.5" />
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      <span>{step.label}</span>
    </div>
  );
}

export function LEAPSStepChips() {
  const { state } = useLEAPSFlow();
  const { currentStep, completedSteps, isProcessing } = state;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((step, index) => (
        <React.Fragment key={step.id}>
          <StepChip
            step={step}
            status={getStepStatus(step.id, currentStep, completedSteps, isProcessing)}
            isProcessing={isProcessing && step.id === currentStep}
          />
          {index < STEPS.length - 1 && (
            <div className="w-4 h-px bg-gray-300 dark:bg-slate-600" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default LEAPSStepChips;
