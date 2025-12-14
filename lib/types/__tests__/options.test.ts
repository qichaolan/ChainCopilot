/**
 * Tests for Options Types and Validation Utilities
 *
 * Coverage targets:
 * - isValidTicker: all branches (valid, invalid, edge cases)
 * - isValidExpirationDate: all branches (valid, invalid, edge cases)
 * - sanitizeTicker: all branches
 * - toDisplayOption: transformation correctness
 */

import { describe, it, expect } from 'vitest';
import {
  isValidTicker,
  isValidExpirationDate,
  sanitizeTicker,
  toDisplayOption,
  TICKER_PATTERN,
  DATE_PATTERN,
  MAX_TICKER_LENGTH,
  type RawOptionsContract,
} from '../options';

describe('Options Validation Utilities', () => {
  describe('isValidTicker', () => {
    // Positive cases - valid tickers
    it('should accept valid single-letter ticker', () => {
      expect(isValidTicker('A')).toBe(true);
    });

    it('should accept valid 2-letter ticker', () => {
      expect(isValidTicker('GM')).toBe(true);
    });

    it('should accept valid 3-letter ticker', () => {
      expect(isValidTicker('IBM')).toBe(true);
    });

    it('should accept valid 4-letter ticker', () => {
      expect(isValidTicker('AAPL')).toBe(true);
    });

    it('should accept valid 5-letter ticker', () => {
      expect(isValidTicker('GOOGL')).toBe(true);
    });

    it('should accept lowercase and normalize to uppercase', () => {
      expect(isValidTicker('aapl')).toBe(true);
    });

    it('should accept mixed case', () => {
      expect(isValidTicker('AaPl')).toBe(true);
    });

    it('should accept ticker with leading/trailing whitespace', () => {
      expect(isValidTicker('  AAPL  ')).toBe(true);
    });

    // Negative cases - invalid tickers
    it('should reject empty string', () => {
      expect(isValidTicker('')).toBe(false);
    });

    it('should reject null input', () => {
      expect(isValidTicker(null as unknown as string)).toBe(false);
    });

    it('should reject undefined input', () => {
      expect(isValidTicker(undefined as unknown as string)).toBe(false);
    });

    it('should reject numeric ticker', () => {
      expect(isValidTicker('12345')).toBe(false);
    });

    it('should reject ticker with numbers', () => {
      expect(isValidTicker('AAPL1')).toBe(false);
    });

    it('should reject ticker with special characters', () => {
      expect(isValidTicker('AA-PL')).toBe(false);
    });

    it('should reject ticker longer than 5 characters', () => {
      expect(isValidTicker('ABCDEF')).toBe(false);
    });

    it('should reject ticker with spaces in middle', () => {
      expect(isValidTicker('AA PL')).toBe(false);
    });

    it('should reject ticker with unicode characters', () => {
      expect(isValidTicker('AAPL™')).toBe(false);
    });

    // Edge cases
    it('should reject whitespace-only string', () => {
      expect(isValidTicker('   ')).toBe(false);
    });

    it('should reject non-string input (number)', () => {
      expect(isValidTicker(123 as unknown as string)).toBe(false);
    });

    it('should reject non-string input (object)', () => {
      expect(isValidTicker({} as unknown as string)).toBe(false);
    });
  });

  describe('isValidExpirationDate', () => {
    // Positive cases - valid dates
    it('should accept valid date format YYYY-MM-DD', () => {
      expect(isValidExpirationDate('2024-01-19')).toBe(true);
    });

    it('should accept date at start of year', () => {
      expect(isValidExpirationDate('2024-01-01')).toBe(true);
    });

    it('should accept date at end of year', () => {
      expect(isValidExpirationDate('2024-12-31')).toBe(true);
    });

    it('should accept leap year date Feb 29', () => {
      expect(isValidExpirationDate('2024-02-29')).toBe(true);
    });

    it('should accept future date', () => {
      expect(isValidExpirationDate('2030-06-15')).toBe(true);
    });

    // Negative cases - invalid dates
    it('should reject empty string', () => {
      expect(isValidExpirationDate('')).toBe(false);
    });

    it('should reject null input', () => {
      expect(isValidExpirationDate(null as unknown as string)).toBe(false);
    });

    it('should reject undefined input', () => {
      expect(isValidExpirationDate(undefined as unknown as string)).toBe(false);
    });

    it('should reject wrong format MM-DD-YYYY', () => {
      expect(isValidExpirationDate('01-19-2024')).toBe(false);
    });

    it('should reject wrong format DD/MM/YYYY', () => {
      expect(isValidExpirationDate('19/01/2024')).toBe(false);
    });

    it('should reject invalid month 13', () => {
      expect(isValidExpirationDate('2024-13-01')).toBe(false);
    });

    it('should reject invalid day 32', () => {
      expect(isValidExpirationDate('2024-01-32')).toBe(false);
    });

    it('should reject Feb 30', () => {
      expect(isValidExpirationDate('2024-02-30')).toBe(false);
    });

    it('should reject non-leap year Feb 29', () => {
      expect(isValidExpirationDate('2023-02-29')).toBe(false);
    });

    it('should reject date with extra characters', () => {
      expect(isValidExpirationDate('2024-01-19T00:00:00')).toBe(false);
    });

    it('should reject date with spaces', () => {
      expect(isValidExpirationDate('2024 01 19')).toBe(false);
    });

    // Edge cases
    it('should reject partial date', () => {
      expect(isValidExpirationDate('2024-01')).toBe(false);
    });

    it('should reject date with leading zeros missing', () => {
      expect(isValidExpirationDate('2024-1-19')).toBe(false);
    });
  });

  describe('sanitizeTicker', () => {
    // Positive cases
    it('should return uppercase ticker for valid lowercase input', () => {
      expect(sanitizeTicker('aapl')).toBe('AAPL');
    });

    it('should return uppercase ticker for valid mixed case input', () => {
      expect(sanitizeTicker('AaPl')).toBe('AAPL');
    });

    it('should trim whitespace and return uppercase ticker', () => {
      expect(sanitizeTicker('  aapl  ')).toBe('AAPL');
    });

    it('should return same ticker for valid uppercase input', () => {
      expect(sanitizeTicker('NVDA')).toBe('NVDA');
    });

    // Negative cases
    it('should return null for empty string', () => {
      expect(sanitizeTicker('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(sanitizeTicker(null as unknown as string)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(sanitizeTicker(undefined as unknown as string)).toBeNull();
    });

    it('should return null for invalid ticker with numbers', () => {
      expect(sanitizeTicker('AAPL1')).toBeNull();
    });

    it('should return null for ticker too long', () => {
      expect(sanitizeTicker('ABCDEF')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(sanitizeTicker('   ')).toBeNull();
    });
  });

  describe('toDisplayOption', () => {
    it('should transform raw contract to display format with all fields', () => {
      const raw: RawOptionsContract = {
        contract_symbol: 'AAPL240119C00150000',
        underlying_symbol: 'AAPL',
        underlying_price: 185.50,
        expiration: '2024-01-19',
        dte: 30,
        strike: 150,
        option_type: 'call',
        bid: 35.50,
        ask: 36.00,
        last_price: 35.75,
        theoretical_price: 35.80,
        mark: 35.75,
        open: 35.00,
        high: 36.50,
        low: 34.50,
        prev_close: 35.00,
        change: 0.75,
        change_percent: 2.14,
        volume: 1500,
        open_interest: 25000,
        implied_volatility: 0.35,
        delta: 0.85,
        gamma: 0.012,
        theta: -0.15,
        vega: 0.25,
        rho: 0.08,
      };

      const display = toDisplayOption(raw);

      expect(display).toEqual({
        strike: 150,
        bid: 35.50,
        ask: 36.00,
        last: 35.75,
        volume: 1500,
        oi: 25000,
        iv: 0.35,
        delta: 0.85,
        gamma: 0.012,
        theta: -0.15,
        vega: 0.25,
      });
    });

    it('should handle null values by defaulting to 0', () => {
      const raw: RawOptionsContract = {
        contract_symbol: 'AAPL240119C00150000',
        underlying_symbol: 'AAPL',
        underlying_price: null,
        expiration: '2024-01-19',
        dte: null,
        strike: null,
        option_type: 'call',
        bid: null,
        ask: null,
        last_price: null,
        theoretical_price: null,
        mark: null,
        open: null,
        high: null,
        low: null,
        prev_close: null,
        change: null,
        change_percent: null,
        volume: null,
        open_interest: null,
        implied_volatility: null,
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
        rho: null,
      };

      const display = toDisplayOption(raw);

      expect(display).toEqual({
        strike: 0,
        bid: 0,
        ask: 0,
        last: 0,
        volume: 0,
        oi: 0,
        iv: 0,
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
      });
    });

    it('should handle mixed null and valid values', () => {
      const raw: RawOptionsContract = {
        contract_symbol: 'AAPL240119C00150000',
        underlying_symbol: 'AAPL',
        underlying_price: 185.50,
        expiration: '2024-01-19',
        dte: 30,
        strike: 150,
        option_type: 'call',
        bid: 35.50,
        ask: null,
        last_price: 35.75,
        theoretical_price: null,
        mark: null,
        open: null,
        high: null,
        low: null,
        prev_close: null,
        change: null,
        change_percent: null,
        volume: 1500,
        open_interest: null,
        implied_volatility: 0.35,
        delta: null,
        gamma: 0.012,
        theta: null,
        vega: 0.25,
        rho: null,
      };

      const display = toDisplayOption(raw);

      expect(display.strike).toBe(150);
      expect(display.bid).toBe(35.50);
      expect(display.ask).toBe(0);
      expect(display.last).toBe(35.75);
      expect(display.volume).toBe(1500);
      expect(display.oi).toBe(0);
      expect(display.iv).toBe(0.35);
      expect(display.delta).toBe(0);
      expect(display.gamma).toBe(0.012);
      expect(display.theta).toBe(0);
      expect(display.vega).toBe(0.25);
    });
  });

  describe('Constants', () => {
    it('TICKER_PATTERN should match valid tickers', () => {
      expect(TICKER_PATTERN.test('A')).toBe(true);
      expect(TICKER_PATTERN.test('AAPL')).toBe(true);
      expect(TICKER_PATTERN.test('GOOGL')).toBe(true);
    });

    it('TICKER_PATTERN should not match invalid tickers', () => {
      expect(TICKER_PATTERN.test('')).toBe(false);
      expect(TICKER_PATTERN.test('ABCDEF')).toBe(false);
      expect(TICKER_PATTERN.test('AAP1')).toBe(false);
    });

    it('DATE_PATTERN should match valid date format', () => {
      expect(DATE_PATTERN.test('2024-01-19')).toBe(true);
      expect(DATE_PATTERN.test('2030-12-31')).toBe(true);
    });

    it('DATE_PATTERN should not match invalid date format', () => {
      expect(DATE_PATTERN.test('01-19-2024')).toBe(false);
      expect(DATE_PATTERN.test('2024/01/19')).toBe(false);
      expect(DATE_PATTERN.test('2024-1-19')).toBe(false);
    });

    it('MAX_TICKER_LENGTH should be 5', () => {
      expect(MAX_TICKER_LENGTH).toBe(5);
    });
  });
});
