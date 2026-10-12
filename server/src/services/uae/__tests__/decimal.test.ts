import { describe, it, expect } from 'vitest';
import { Decimal } from '../utils/decimal.js';

describe('Decimal Utility - High Precision Arithmetic', () => {
  it('should correctly add decimal values without floating point errors', () => {
    // 0.1 + 0.2 in JS is 0.30000000000000004
    const a = new Decimal('0.1');
    const b = new Decimal('0.2');
    const sum = a.add(b);
    expect(sum.toFixed(2)).toBe('0.30');
    expect(sum.toFixed(1)).toBe('0.3');
  });

  it('should subtract correctly', () => {
    const a = new Decimal('100.50');
    const b = new Decimal('25.25');
    expect(a.sub(b).toFixed(2)).toBe('75.25');
  });

  it('should multiply values and maintain accurate scaling', () => {
    const qty = new Decimal('3');
    const price = new Decimal('33.3333');
    const product = qty.mul(price);
    expect(product.toFixed(4)).toBe('99.9999');
    expect(product.round(2).toFixed(2)).toBe('100.00');
  });

  it('should divide accurately', () => {
    const total = new Decimal('100.00');
    const count = new Decimal('3');
    const result = total.div(count);
    expect(result.toFixed(4)).toBe('33.3333');
    expect(result.round(2).toFixed(2)).toBe('33.33');
  });

  it('should throw on division by zero', () => {
    const a = new Decimal('50.00');
    expect(() => a.div(0)).toThrow('Division by zero');
  });

  it('should implement HALF_UP rounding correctly according to UAE VAT Art. 61', () => {
    // 0.515 rounds to 0.52
    expect(new Decimal('0.515').round(2, 'HALF_UP').toFixed(2)).toBe('0.52');
    // 0.514 rounds to 0.51
    expect(new Decimal('0.514').round(2, 'HALF_UP').toFixed(2)).toBe('0.51');
    // 0.516 rounds to 0.52
    expect(new Decimal('0.516').round(2, 'HALF_UP').toFixed(2)).toBe('0.52');
    // 10.33 * 0.05 = 0.5165 -> 0.52
    expect(new Decimal('0.5165').round(2, 'HALF_UP').toFixed(2)).toBe('0.52');
    // 20.67 * 0.05 = 1.0335 -> 1.03
    expect(new Decimal('1.0335').round(2, 'HALF_UP').toFixed(2)).toBe('1.03');
  });

  it('should correctly compare decimal numbers', () => {
    const a = new Decimal('10.50');
    const b = new Decimal('10.500');
    const c = new Decimal('15.00');

    expect(a.eq(b)).toBe(true);
    expect(a.lt(c)).toBe(true);
    expect(c.gt(a)).toBe(true);
    expect(a.lte(b)).toBe(true);
    expect(a.gte(b)).toBe(true);
  });

  it('should handle negative numbers and zero checks', () => {
    const neg = new Decimal('-45.75');
    expect(neg.isNegative()).toBe(true);
    expect(neg.abs().toFixed(2)).toBe('45.75');

    const zero = new Decimal('0.0000');
    expect(zero.isZero()).toBe(true);
  });
});
