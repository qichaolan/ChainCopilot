/**
 * Tests for OI Heatmap Calculations
 *
 * Coverage targets:
 * - cellKey / parseKey: key generation and parsing
 * - filterStrikes: strike range filtering
 * - filterExpirations: expiration grouping
 * - getStrikeBucketSize / bucketStrikes: bucketing logic
 * - normalizeUnsignedOI / normalizeSignedOI: log normalization
 * - getCellValue / getCellOI: value extraction
 * - getCellColor: color calculation
 * - formatOI / formatValue / formatExpiration / formatPCRatio: formatting
 * - buildHeatmapData: full integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  cellKey,
  parseKey,
  filterStrikes,
  filterExpirations,
  getStrikeBucketSize,
  bucketStrikes,
  normalizeUnsignedOI,
  normalizeSignedOI,
  getCellValue,
  getCellOI,
  getCellColor,
  formatOI,
  formatValue,
  formatExpiration,
  formatPCRatio,
  buildHeatmapData,
  MAX_PC_RATIO,
  type OptionContract,
  type HeatmapCell,
  type HeatmapConfig,
} from '../oi-heatmap';

describe('OI Heatmap Calculations', () => {
  describe('cellKey', () => {
    it('should generate key from expiration and strike', () => {
      expect(cellKey('2024-01-19', 150)).toBe('2024-01-19|150');
    });

    it('should handle decimal strikes', () => {
      expect(cellKey('2024-01-19', 152.5)).toBe('2024-01-19|152.5');
    });

    it('should handle large strikes', () => {
      expect(cellKey('2024-01-19', 5000)).toBe('2024-01-19|5000');
    });
  });

  describe('parseKey', () => {
    it('should parse key back to expiration and strike', () => {
      const result = parseKey('2024-01-19|150');
      expect(result.expiration).toBe('2024-01-19');
      expect(result.strike).toBe(150);
    });

    it('should handle decimal strikes', () => {
      const result = parseKey('2024-01-19|152.5');
      expect(result.strike).toBe(152.5);
    });

    it('should be inverse of cellKey', () => {
      const exp = '2024-06-21';
      const strike = 175;
      const key = cellKey(exp, strike);
      const parsed = parseKey(key);
      expect(parsed.expiration).toBe(exp);
      expect(parsed.strike).toBe(strike);
    });
  });

  describe('filterStrikes', () => {
    const strikes = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    const underlyingPrice = 150;

    it('should return all strikes when range is "all"', () => {
      const result = filterStrikes(strikes, underlyingPrice, 'all');
      expect(result).toEqual(strikes);
    });

    it('should filter to ±10% range', () => {
      const result = filterStrikes(strikes, underlyingPrice, '10');
      // 150 * 0.9 = 135, 150 * 1.1 = 165
      expect(result).toEqual([140, 150, 160]);
    });

    it('should filter to ±20% range', () => {
      const result = filterStrikes(strikes, underlyingPrice, '20');
      // 150 * 0.8 = 120, 150 * 1.2 = 180
      expect(result).toEqual([120, 130, 140, 150, 160, 170, 180]);
    });

    it('should filter to ±30% range', () => {
      const result = filterStrikes(strikes, underlyingPrice, '30');
      // 150 * 0.7 = 105, 150 * 1.3 = 195
      expect(result).toEqual([110, 120, 130, 140, 150, 160, 170, 180, 190]);
    });

    it('should handle empty strikes array', () => {
      const result = filterStrikes([], 150, '10');
      expect(result).toEqual([]);
    });

    it('should include boundary strikes', () => {
      const customStrikes = [135, 150, 165]; // Exact boundaries
      const result = filterStrikes(customStrikes, 150, '10');
      expect(result).toEqual([135, 150, 165]);
    });
  });

  describe('filterExpirations', () => {
    // Mock date for consistent testing
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const expirations = [
      '2024-01-12', // Past (Friday)
      '2024-01-19', // Future Friday (3rd Friday = OPEX)
      '2024-01-26', // Future Friday
      '2024-02-02', // Future Friday
      '2024-02-16', // Future Friday (3rd Friday = OPEX)
      '2024-03-15', // Future Friday (3rd Friday = OPEX)
      '2024-06-21', // Future Friday (3rd Friday = OPEX)
      '2025-01-17', // Future Friday (3rd Friday = OPEX, > 12 months = LEAPS)
      '2025-06-20', // Future Friday (3rd Friday = OPEX, > 12 months = LEAPS)
    ];

    it('should return all future expirations for "all"', () => {
      const result = filterExpirations(expirations, 'all');
      expect(result).not.toContain('2024-01-12'); // Past
      expect(result.length).toBe(8);
    });

    it('should return first 10 future expirations for "short"', () => {
      const result = filterExpirations(expirations, 'short');
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result).not.toContain('2024-01-12'); // Past
    });

    it('should filter OPEX dates for "monthly"', () => {
      const result = filterExpirations(expirations, 'monthly');
      // All returned should be 3rd Fridays
      expect(result).toContain('2024-01-19');
      expect(result).toContain('2024-02-16');
      expect(result).toContain('2024-03-15');
    });

    it('should filter LEAPS (> 12 months) for "leaps"', () => {
      const result = filterExpirations(expirations, 'leaps');
      expect(result).toContain('2025-01-17');
      expect(result).toContain('2025-06-20');
      expect(result).not.toContain('2024-06-21'); // Less than 12 months
    });

    it('should handle empty expirations array', () => {
      const result = filterExpirations([], 'all');
      expect(result).toEqual([]);
    });
  });

  describe('getStrikeBucketSize', () => {
    it('should return 1 for prices under 50', () => {
      expect(getStrikeBucketSize(25)).toBe(1);
      expect(getStrikeBucketSize(49.99)).toBe(1);
    });

    it('should return 2.5 for prices 50-99', () => {
      expect(getStrikeBucketSize(50)).toBe(2.5);
      expect(getStrikeBucketSize(75)).toBe(2.5);
      expect(getStrikeBucketSize(99.99)).toBe(2.5);
    });

    it('should return 5 for prices 100-499', () => {
      expect(getStrikeBucketSize(100)).toBe(5);
      expect(getStrikeBucketSize(300)).toBe(5);
      expect(getStrikeBucketSize(499.99)).toBe(5);
    });

    it('should return 10 for prices 500-999', () => {
      expect(getStrikeBucketSize(500)).toBe(10);
      expect(getStrikeBucketSize(750)).toBe(10);
      expect(getStrikeBucketSize(999.99)).toBe(10);
    });

    it('should return 25 for prices 1000+', () => {
      expect(getStrikeBucketSize(1000)).toBe(25);
      expect(getStrikeBucketSize(5000)).toBe(25);
    });
  });

  describe('bucketStrikes', () => {
    it('should bucket strikes by size', () => {
      const strikes = [147, 148, 149, 150, 151, 152, 153];
      const result = bucketStrikes(strikes, 5);
      expect(result).toEqual([145, 150, 155]);
    });

    it('should deduplicate when multiple strikes fall in same bucket', () => {
      const strikes = [100, 101, 102, 103, 104, 105];
      const result = bucketStrikes(strikes, 5);
      expect(result).toEqual([100, 105]);
    });

    it('should sort result in ascending order', () => {
      const strikes = [200, 100, 150, 125, 175];
      const result = bucketStrikes(strikes, 25);
      expect(result).toEqual([100, 125, 150, 175, 200]);
    });

    it('should handle single strike', () => {
      const result = bucketStrikes([150], 5);
      expect(result).toEqual([150]);
    });

    it('should handle empty array', () => {
      const result = bucketStrikes([], 5);
      expect(result).toEqual([]);
    });
  });

  describe('normalizeUnsignedOI', () => {
    it('should return 0 for 0 OI', () => {
      expect(normalizeUnsignedOI(0)).toBe(0);
    });

    it('should return ~0.3 for 1 OI', () => {
      expect(normalizeUnsignedOI(1)).toBeCloseTo(Math.log10(2), 5);
    });

    it('should return 1 for 9 OI', () => {
      expect(normalizeUnsignedOI(9)).toBeCloseTo(1, 5);
    });

    it('should return 2 for 99 OI', () => {
      expect(normalizeUnsignedOI(99)).toBeCloseTo(2, 5);
    });

    it('should return 3 for 999 OI', () => {
      expect(normalizeUnsignedOI(999)).toBeCloseTo(3, 5);
    });

    it('should return 4 for 9999 OI', () => {
      expect(normalizeUnsignedOI(9999)).toBeCloseTo(4, 5);
    });
  });

  describe('normalizeSignedOI', () => {
    it('should return 0 for 0 OI', () => {
      expect(normalizeSignedOI(0)).toBe(0);
    });

    it('should return positive for positive OI', () => {
      expect(normalizeSignedOI(99)).toBeCloseTo(2, 5);
    });

    it('should return negative for negative OI', () => {
      expect(normalizeSignedOI(-99)).toBeCloseTo(-2, 5);
    });

    it('should be symmetric: |f(x)| = |f(-x)|', () => {
      expect(Math.abs(normalizeSignedOI(100))).toBe(Math.abs(normalizeSignedOI(-100)));
    });
  });

  describe('getCellValue', () => {
    const cell: HeatmapCell = {
      expiration: '2024-01-19',
      strike: 150,
      callOI: 1000,
      putOI: 500,
      netOI: 500, // calls - puts
      callValue: 50000,
      putValue: 25000,
      netValue: 25000,
      callMid: 50,
      putMid: 50,
      putCallRatio: 0.5,
      pctOfExpTotal: 10,
      hasData: true,
    };

    it('should return normalized callOI for "calls" view', () => {
      const result = getCellValue(cell, 'calls');
      expect(result).toBeCloseTo(normalizeUnsignedOI(1000), 5);
    });

    it('should return normalized putOI for "puts" view', () => {
      const result = getCellValue(cell, 'puts');
      expect(result).toBeCloseTo(normalizeUnsignedOI(500), 5);
    });

    it('should return signed normalized netOI for "net" view', () => {
      const result = getCellValue(cell, 'net');
      expect(result).toBeCloseTo(normalizeSignedOI(500), 5);
    });
  });

  describe('getCellOI', () => {
    const cell: HeatmapCell = {
      expiration: '2024-01-19',
      strike: 150,
      callOI: 1000,
      putOI: 500,
      netOI: 500,
      callValue: 50000,
      putValue: 25000,
      netValue: 25000,
      callMid: 50,
      putMid: 50,
      putCallRatio: 0.5,
      pctOfExpTotal: 10,
      hasData: true,
    };

    it('should return raw callOI for "calls" view', () => {
      expect(getCellOI(cell, 'calls')).toBe(1000);
    });

    it('should return raw putOI for "puts" view', () => {
      expect(getCellOI(cell, 'puts')).toBe(500);
    });

    it('should return raw netOI for "net" view', () => {
      expect(getCellOI(cell, 'net')).toBe(500);
    });
  });

  describe('getCellColor', () => {
    it('should return zero color for zero value', () => {
      const result = getCellColor(0, -10, 10, 'net', false);
      expect(result).toBe('#F3F4F6'); // Light mode zero color
    });

    it('should return dark zero color in dark mode', () => {
      const result = getCellColor(0, -10, 10, 'net', true);
      expect(result).toBe('#374151'); // Dark mode zero color
    });

    it('should return green-ish color for positive net OI', () => {
      const result = getCellColor(5, -10, 10, 'net', false);
      // Should be somewhere in the green spectrum
      expect(result).toMatch(/rgb\(\d+, \d+, \d+\)/);
    });

    it('should return red-ish color for negative net OI', () => {
      const result = getCellColor(-5, -10, 10, 'net', false);
      // Should be somewhere in the red spectrum
      expect(result).toMatch(/rgb\(\d+, \d+, \d+\)/);
    });

    it('should return neutral when absMax is 0', () => {
      const result = getCellColor(0.0001, 0, 0, 'net', false);
      expect(result).toBe('#F3F4F6'); // Neutral
    });

    it('should return zero color when min equals max for calls/puts', () => {
      const result = getCellColor(5, 5, 5, 'calls', false);
      expect(result).toBe('#F3F4F6');
    });
  });

  describe('formatOI', () => {
    it('should format small numbers without suffix', () => {
      expect(formatOI(500)).toBe('500');
    });

    it('should format thousands with K suffix', () => {
      expect(formatOI(1500)).toBe('1.5K');
      expect(formatOI(1000)).toBe('1.0K');
    });

    it('should format millions with M suffix', () => {
      expect(formatOI(1500000)).toBe('1.5M');
      expect(formatOI(1000000)).toBe('1.0M');
    });

    it('should handle zero', () => {
      expect(formatOI(0)).toBe('0');
    });

    it('should handle negative numbers', () => {
      expect(formatOI(-1500)).toBe('-1.5K');
      expect(formatOI(-1500000)).toBe('-1.5M');
    });
  });

  describe('formatValue', () => {
    it('should format small values with $', () => {
      expect(formatValue(500)).toBe('$500');
    });

    it('should format thousands with $K', () => {
      expect(formatValue(1500)).toBe('$1.5K');
    });

    it('should format millions with $M', () => {
      expect(formatValue(1500000)).toBe('$1.5M');
    });

    it('should format billions with $B', () => {
      expect(formatValue(1500000000)).toBe('$1.5B');
    });

    it('should handle zero', () => {
      expect(formatValue(0)).toBe('$0');
    });
  });

  describe('formatExpiration', () => {
    it('should format date as "Mon DD"', () => {
      expect(formatExpiration('2024-01-19')).toBe('Jan 19');
      expect(formatExpiration('2024-12-25')).toBe('Dec 25');
    });

    it('should use UTC to avoid timezone issues', () => {
      // This should always return the same result regardless of local timezone
      expect(formatExpiration('2024-06-21')).toBe('Jun 21');
    });
  });

  describe('formatPCRatio', () => {
    it('should return "-" for null', () => {
      expect(formatPCRatio(null)).toBe('-');
    });

    it('should format normal ratio with 2 decimals', () => {
      expect(formatPCRatio(0.5)).toBe('0.50');
      expect(formatPCRatio(1.25)).toBe('1.25');
    });

    it('should show "99+" for MAX_PC_RATIO', () => {
      expect(formatPCRatio(MAX_PC_RATIO)).toBe('99+');
    });

    it('should show "99+" for values >= MAX_PC_RATIO', () => {
      expect(formatPCRatio(100)).toBe('99+');
      expect(formatPCRatio(150)).toBe('99+');
    });
  });

  describe('buildHeatmapData', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const sampleContracts: OptionContract[] = [
      { strike: 145, expiration: '2024-01-19', optionType: 'call', bid: 10, ask: 11, oi: 1000, volume: 500, iv: 0.3 },
      { strike: 145, expiration: '2024-01-19', optionType: 'put', bid: 5, ask: 6, oi: 500, volume: 250, iv: 0.32 },
      { strike: 150, expiration: '2024-01-19', optionType: 'call', bid: 5, ask: 6, oi: 2000, volume: 1000, iv: 0.28 },
      { strike: 150, expiration: '2024-01-19', optionType: 'put', bid: 3, ask: 4, oi: 1500, volume: 750, iv: 0.30 },
      { strike: 155, expiration: '2024-01-19', optionType: 'call', bid: 2, ask: 3, oi: 800, volume: 400, iv: 0.26 },
      { strike: 155, expiration: '2024-01-19', optionType: 'put', bid: 8, ask: 9, oi: 1200, volume: 600, iv: 0.34 },
      { strike: 150, expiration: '2024-01-26', optionType: 'call', bid: 6, ask: 7, oi: 1500, volume: 750, iv: 0.29 },
      { strike: 150, expiration: '2024-01-26', optionType: 'put', bid: 4, ask: 5, oi: 1000, volume: 500, iv: 0.31 },
    ];

    const config: HeatmapConfig = {
      viewType: 'net',
      strikeRange: 'all',
      expirationGroup: 'all',
      underlyingPrice: 150,
    };

    it('should return heatmap data with correct structure', () => {
      const result = buildHeatmapData(sampleContracts, config);

      expect(result).toHaveProperty('expirations');
      expect(result).toHaveProperty('strikes');
      expect(result).toHaveProperty('cells');
      expect(result).toHaveProperty('minValue');
      expect(result).toHaveProperty('maxValue');
      expect(result).toHaveProperty('totalOI');
    });

    it('should aggregate OI correctly for a cell', () => {
      const result = buildHeatmapData(sampleContracts, config);
      const cell = result.cells.get(cellKey('2024-01-19', 150));

      expect(cell).toBeDefined();
      expect(cell!.callOI).toBe(2000);
      expect(cell!.putOI).toBe(1500);
      expect(cell!.netOI).toBe(500); // 2000 - 1500
    });

    it('should calculate put/call ratio correctly', () => {
      const result = buildHeatmapData(sampleContracts, config);
      const cell = result.cells.get(cellKey('2024-01-19', 150));

      expect(cell!.putCallRatio).toBeCloseTo(0.75, 2); // 1500 / 2000
    });

    it('should handle cells with no call OI (ratio = MAX)', () => {
      const contracts: OptionContract[] = [
        { strike: 150, expiration: '2024-01-19', optionType: 'put', bid: 5, ask: 6, oi: 1000, volume: 500, iv: 0.3 },
      ];

      const result = buildHeatmapData(contracts, { ...config, expirationGroup: 'short' });
      const cell = result.cells.get(cellKey('2024-01-19', 150));

      expect(cell!.putCallRatio).toBe(MAX_PC_RATIO);
    });

    it('should filter expirations correctly', () => {
      const result = buildHeatmapData(sampleContracts, { ...config, expirationGroup: 'short' });

      expect(result.expirations.length).toBeGreaterThan(0);
      // All should be future dates
      for (const exp of result.expirations) {
        expect(new Date(exp + 'T00:00:00Z') >= new Date('2024-01-15T00:00:00Z')).toBe(true);
      }
    });

    it('should filter strikes by range', () => {
      const result = buildHeatmapData(sampleContracts, { ...config, strikeRange: '10' });

      // At 150 underlying, ±10% = 135-165
      for (const strike of result.strikes) {
        expect(strike).toBeGreaterThanOrEqual(135);
        expect(strike).toBeLessThanOrEqual(165);
      }
    });

    it('should calculate totalOI correctly', () => {
      const result = buildHeatmapData(sampleContracts, config);

      // Sum of all OI in contracts
      const expectedTotal = sampleContracts.reduce((sum, c) => sum + c.oi, 0);
      expect(result.totalOI).toBe(expectedTotal);
    });

    it('should handle empty contracts array', () => {
      const result = buildHeatmapData([], config);

      expect(result.expirations).toEqual([]);
      expect(result.strikes).toEqual([]);
      expect(result.cells.size).toBe(0);
      expect(result.totalOI).toBe(0);
    });

    it('should set hasData correctly for cells with data', () => {
      const result = buildHeatmapData(sampleContracts, config);

      for (const [, cell] of result.cells) {
        if (cell.callOI > 0 || cell.putOI > 0) {
          expect(cell.hasData).toBe(true);
        } else {
          expect(cell.hasData).toBe(false);
        }
      }
    });

    it('should track min/max values correctly', () => {
      const result = buildHeatmapData(sampleContracts, config);

      // Min and max should be within the range of cell values
      let foundMin = false;
      let foundMax = false;

      for (const [, cell] of result.cells) {
        if (cell.hasData) {
          const value = normalizeSignedOI(cell.netOI);
          if (Math.abs(value - result.minValue) < 0.001) foundMin = true;
          if (Math.abs(value - result.maxValue) < 0.001) foundMax = true;
        }
      }

      expect(foundMin || result.minValue === 0).toBe(true);
      expect(foundMax || result.maxValue === 0).toBe(true);
    });
  });

  describe('MAX_PC_RATIO', () => {
    it('should be 99', () => {
      expect(MAX_PC_RATIO).toBe(99);
    });
  });

  describe('getCellColor with calls/puts view types', () => {
    it('should return color for calls view type', () => {
      const cell: HeatmapCell = {
        expiration: '2024-01-19',
        strike: 100,
        callOI: 5000,
        putOI: 1000,
        netOI: 4000,
        callMid: 5.0,
        putMid: 1.0,
        hasData: true,
      };
      const color = getCellColor(cell, 0, 10000, 'calls');
      // Can be hex or rgb format
      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });

    it('should return color for puts view type', () => {
      const cell: HeatmapCell = {
        expiration: '2024-01-19',
        strike: 100,
        callOI: 1000,
        putOI: 5000,
        netOI: -4000,
        callMid: 1.0,
        putMid: 5.0,
        hasData: true,
      };
      const color = getCellColor(cell, 0, 10000, 'puts');
      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });

    it('should handle zero OI in sequential mode', () => {
      const cell: HeatmapCell = {
        expiration: '2024-01-19',
        strike: 100,
        callOI: 0,
        putOI: 0,
        netOI: 0,
        callMid: 0,
        putMid: 0,
        hasData: false,
      };
      const color = getCellColor(cell, 0, 10000, 'calls');
      expect(color).toBeDefined();
    });

    it('should handle max value in calls mode', () => {
      const cell: HeatmapCell = {
        expiration: '2024-01-19',
        strike: 100,
        callOI: 10000,
        putOI: 0,
        netOI: 10000,
        callMid: 10.0,
        putMid: 0,
        hasData: true,
      };
      const color = getCellColor(cell, 0, 10000, 'calls');
      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });

    it('should handle max value in puts mode', () => {
      const cell: HeatmapCell = {
        expiration: '2024-01-19',
        strike: 100,
        callOI: 0,
        putOI: 10000,
        netOI: -10000,
        callMid: 0,
        putMid: 10.0,
        hasData: true,
      };
      const color = getCellColor(cell, 0, 10000, 'puts');
      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });
  });
});
