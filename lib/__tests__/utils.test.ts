/**
 * Tests for Utility Functions
 *
 * Coverage targets:
 * - cn: class name merging
 * - formatCurrency: currency formatting
 * - formatPercent: percentage formatting
 * - formatNumber: number formatting
 * - formatCompactNumber: compact number formatting
 */

import { describe, it, expect } from 'vitest';
import {
  cn,
  formatCurrency,
  formatPercent,
  formatNumber,
  formatCompactNumber,
} from '../utils';

describe('Utility Functions', () => {
  describe('cn (class name merger)', () => {
    // Positive cases
    it('should merge single class', () => {
      expect(cn('foo')).toBe('foo');
    });

    it('should merge multiple classes', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should handle conditional classes', () => {
      expect(cn('foo', true && 'bar')).toBe('foo bar');
      expect(cn('foo', false && 'bar')).toBe('foo');
    });

    it('should merge tailwind classes correctly', () => {
      expect(cn('px-4', 'px-6')).toBe('px-6');
    });

    it('should handle array of classes', () => {
      expect(cn(['foo', 'bar'])).toBe('foo bar');
    });

    it('should handle object notation', () => {
      expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
    });

    // Edge cases
    it('should handle empty input', () => {
      expect(cn()).toBe('');
    });

    it('should handle null and undefined', () => {
      expect(cn('foo', null, undefined, 'bar')).toBe('foo bar');
    });

    it('should handle empty strings', () => {
      expect(cn('foo', '', 'bar')).toBe('foo bar');
    });

    it('should deduplicate conflicting tailwind classes', () => {
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });
  });

  describe('formatCurrency', () => {
    // Positive cases
    it('should format positive integer', () => {
      expect(formatCurrency(100)).toBe('$100.00');
    });

    it('should format positive decimal', () => {
      expect(formatCurrency(99.99)).toBe('$99.99');
    });

    it('should format large number with commas', () => {
      expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    });

    it('should format small decimal', () => {
      expect(formatCurrency(0.5)).toBe('$0.50');
    });

    it('should round to 2 decimal places', () => {
      expect(formatCurrency(99.999)).toBe('$100.00');
      expect(formatCurrency(99.994)).toBe('$99.99');
    });

    // Negative cases
    it('should format negative number', () => {
      expect(formatCurrency(-100)).toBe('-$100.00');
    });

    it('should format negative decimal', () => {
      expect(formatCurrency(-99.99)).toBe('-$99.99');
    });

    // Edge cases
    it('should format zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('should format very small positive number', () => {
      expect(formatCurrency(0.01)).toBe('$0.01');
    });

    it('should format very large number', () => {
      const result = formatCurrency(999999999999);
      expect(result).toContain('$');
      expect(result).toContain(',');
    });
  });

  describe('formatPercent', () => {
    // Positive cases - note: input is already in percentage form (e.g., 50 = 50%)
    it('should format whole percentage', () => {
      expect(formatPercent(50)).toBe('50.00%');
    });

    it('should format decimal percentage', () => {
      expect(formatPercent(33.33)).toBe('33.33%');
    });

    it('should format 100%', () => {
      expect(formatPercent(100)).toBe('100.00%');
    });

    it('should format percentage greater than 100', () => {
      expect(formatPercent(150)).toBe('150.00%');
    });

    // Negative cases
    it('should format negative percentage', () => {
      expect(formatPercent(-25)).toBe('-25.00%');
    });

    // Edge cases
    it('should format zero', () => {
      expect(formatPercent(0)).toBe('0.00%');
    });

    it('should format small percentage', () => {
      expect(formatPercent(0.5)).toBe('0.50%');
    });

    it('should round to 2 decimal places', () => {
      expect(formatPercent(33.333)).toBe('33.33%');
      expect(formatPercent(33.336)).toBe('33.34%');
    });
  });

  describe('formatNumber', () => {
    // Positive cases
    it('should format integer with commas', () => {
      expect(formatNumber(1000)).toBe('1,000');
    });

    it('should format large number with commas', () => {
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('should format small number without commas', () => {
      expect(formatNumber(999)).toBe('999');
    });

    it('should format decimal number', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56');
    });

    // Negative cases
    it('should format negative number with commas', () => {
      expect(formatNumber(-1000000)).toBe('-1,000,000');
    });

    // Edge cases
    it('should format zero', () => {
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('formatCompactNumber', () => {
    // Positive cases - small numbers
    it('should format number less than 1000 without suffix', () => {
      expect(formatCompactNumber(500)).toBe('500');
    });

    it('should format 999 without suffix', () => {
      expect(formatCompactNumber(999)).toBe('999');
    });

    // Thousands (K)
    it('should format 1000 as 1K', () => {
      expect(formatCompactNumber(1000)).toBe('1K');
    });

    it('should format 1500 as 1.5K', () => {
      expect(formatCompactNumber(1500)).toBe('1.5K');
    });

    it('should format 999999 as ~1M or 1000K', () => {
      const result = formatCompactNumber(999999);
      // Different locales may format differently
      expect(result).toMatch(/1000K|1M/);
    });

    // Millions (M)
    it('should format 1000000 as 1M', () => {
      expect(formatCompactNumber(1000000)).toBe('1M');
    });

    it('should format 1500000 as 1.5M', () => {
      expect(formatCompactNumber(1500000)).toBe('1.5M');
    });

    // Billions (B)
    it('should format 1000000000 as 1B', () => {
      expect(formatCompactNumber(1000000000)).toBe('1B');
    });

    // Negative cases
    it('should format negative thousands', () => {
      expect(formatCompactNumber(-1500)).toBe('-1.5K');
    });

    it('should format negative millions', () => {
      expect(formatCompactNumber(-1500000)).toBe('-1.5M');
    });

    // Edge cases
    it('should format zero', () => {
      expect(formatCompactNumber(0)).toBe('0');
    });

    it('should format small decimal', () => {
      expect(formatCompactNumber(0.5)).toBe('0.5');
    });

    it('should limit to 1 decimal place', () => {
      const result = formatCompactNumber(1234);
      expect(result).toBe('1.2K');
    });
  });
});
