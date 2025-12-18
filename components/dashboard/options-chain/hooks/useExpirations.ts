/**
 * useExpirations Hook
 * Handles expiration categorization and selection
 */

import { useMemo, useState, useCallback } from "react";
import type { ExpirationType } from "../types";
import { categorizeExpirations } from "../utils";

interface UseExpirationsProps {
  expirations: string[];
}

interface UseExpirationsReturn {
  expirationType: ExpirationType;
  selectedExpiration: string;
  categorizedExpirations: Record<ExpirationType, string[]>;
  currentTypeDates: string[];
  setExpirationType: (type: ExpirationType) => void;
  setSelectedExpiration: (exp: string) => void;
  handleTypeChange: (type: ExpirationType) => void;
  selectClosestExpiration: () => void;
}

export function useExpirations({ expirations }: UseExpirationsProps): UseExpirationsReturn {
  const [expirationType, setExpirationType] = useState<ExpirationType>("all");
  const [selectedExpiration, setSelectedExpiration] = useState<string>("");

  // Categorize expirations by type
  const categorizedExpirations = useMemo(() => {
    return categorizeExpirations(expirations);
  }, [expirations]);

  // Get dates for current expiration type
  const currentTypeDates = categorizedExpirations[expirationType];

  // Handle expiration type change
  const handleTypeChange = useCallback(
    (type: ExpirationType) => {
      setExpirationType(type);
      // Auto-select first date in new category if current selection not available
      const dates = categorizedExpirations[type];
      if (dates.length > 0 && !dates.includes(selectedExpiration)) {
        setSelectedExpiration(dates[0]);
      }
    },
    [categorizedExpirations, selectedExpiration]
  );

  // Select closest expiration to today
  const selectClosestExpiration = useCallback(() => {
    if (expirations.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const closestExpiration =
        expirations.find((d: string) => d >= today) || expirations[0];
      setExpirationType("all");
      setSelectedExpiration(closestExpiration);
    }
  }, [expirations]);

  return {
    expirationType,
    selectedExpiration,
    categorizedExpirations,
    currentTypeDates,
    setExpirationType,
    setSelectedExpiration,
    handleTypeChange,
    selectClosestExpiration,
  };
}
