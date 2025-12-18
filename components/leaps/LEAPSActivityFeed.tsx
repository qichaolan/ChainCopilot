'use client';

/**
 * LEAPSActivityFeed - Real-time activity log for LEAPS workflow
 *
 * Shows timestamped events as the agent progresses through steps.
 * Includes: step starts/completions, tool calls, checkpoints, errors
 */

import React from 'react';
import {
  Play,
  CheckCircle,
  Wrench,
  AlertTriangle,
  XCircle,
  User,
  Pause,
  Loader2,
} from 'lucide-react';
import { ActivityItem, useLEAPSFlow } from './LEAPSFlowContext';

const MAX_VISIBLE_ACTIVITIES = 8;

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getActivityIcon(type: ActivityItem['type'], status?: ActivityItem['status']) {
  switch (type) {
    case 'step_start':
      return Play;
    case 'step_complete':
      return CheckCircle;
    case 'tool_call':
    case 'tool_result':
      return Wrench;
    case 'checkpoint':
      return Pause;
    case 'error':
      return XCircle;
    case 'user_action':
      return User;
    default:
      return Loader2;
  }
}

function getActivityColor(status?: ActivityItem['status']) {
  switch (status) {
    case 'running':
      return 'text-blue-500';
    case 'success':
      return 'text-green-500';
    case 'warning':
      return 'text-amber-500';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

interface ActivityRowProps {
  activity: ActivityItem;
  isLatest: boolean;
}

function ActivityRow({ activity, isLatest }: ActivityRowProps) {
  const Icon = getActivityIcon(activity.type, activity.status);
  const colorClass = getActivityColor(activity.status);

  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-2 rounded text-xs ${
        isLatest ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
    >
      <span className="text-gray-400 dark:text-gray-500 font-mono shrink-0">
        {formatTimestamp(activity.timestamp)}
      </span>
      <Icon
        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${colorClass} ${
          activity.status === 'running' ? 'animate-pulse' : ''
        }`}
      />
      <span className="text-gray-700 dark:text-gray-300 flex-1">
        {activity.message}
      </span>
      <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px] shrink-0">
        {activity.step}
      </span>
    </div>
  );
}

export function LEAPSActivityFeed() {
  const { state } = useLEAPSFlow();
  const { activities } = state;

  // Show most recent activities first, limited to MAX_VISIBLE
  const visibleActivities = [...activities]
    .reverse()
    .slice(0, MAX_VISIBLE_ACTIVITIES);

  if (activities.length === 0) {
    return (
      <div className="text-center text-gray-400 dark:text-gray-500 text-xs py-4">
        No activity yet. Start a LEAPS analysis to see progress.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {visibleActivities.map((activity, index) => (
        <ActivityRow
          key={activity.id}
          activity={activity}
          isLatest={index === 0}
        />
      ))}
      {activities.length > MAX_VISIBLE_ACTIVITIES && (
        <div className="text-center text-gray-400 dark:text-gray-500 text-[10px] py-1">
          +{activities.length - MAX_VISIBLE_ACTIVITIES} more activities
        </div>
      )}
    </div>
  );
}

export default LEAPSActivityFeed;
