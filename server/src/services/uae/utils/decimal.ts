/**
 * Financial Decimal Utility
 * High-precision, zero-dependency decimal arithmetic backed by native BigInt.
 * Eliminates IEEE-754 floating-point errors (e.g. 0.1 + 0.2 !== 0.3).
 *
 * STATUTORY COMPLIANCE NOTE:
 * UAE Cabinet Decision No. (52) of 2017 on the Executive Regulations of the
 * Federal Decree-Law No. (8) of 2017 on Value Added Tax, Article 61 ("Rounding on Tax Invoices"):
 * "Where the Tax calculated is a fraction of a Fils, it shall be rounded to the nearest whole Fils on a normal rounding basis."
 *
 * "Normal rounding basis" under UAE statutory law corresponds strictly to HALF_UP (Round Half Away From Zero on absolute magnitude).
 * Under this rule:
 * - A fraction >= 0.5 fils (0.005 AED) rounds up to the next fils (e.g., 2.345 AED -> 2.35 AED; 1.665 AED -> 1.67 AED).
 * - A fraction < 0.5 fils (0.004 AED) rounds down (e.g., 2.344 AED -> 2.34 AED; 1.664 AED -> 1.66 AED).
 * - For negative adjustments (Credit Notes), the magnitude is rounded half-up and retains the negative sign (e.g., -2.345 AED -> -2.35 AED).
 * - This is explicitly DISTINGUISHED from Banker's Rounding (Round Half to Even), which would erroneously round 2.345 to 2.34.
 */

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

export class Decimal {
  private readonly value: bigint;
  private readonly scale: number;

  // Standard internal scaling precision (8 decimal places prevents intermediate rounding truncation)
  private static readonly INTERNAL_SCALE = 8;
  private static readonly MULTIPLIER = 10n ** 8n;

  constructor(val: string | number | bigint | Decimal, scale = Decimal.INTERNAL_SCALE) {
    this.scale = scale;
    if (val instanceof Decimal) {
      if (val.scale === scale) {
        this.value = val.value;
      } else if (val.scale < scale) {
        this.value = val.value * (10n ** BigInt(scale - val.scale));
      } else {
        this.value = val.value / (10n ** BigInt(val.scale - scale));
      }
      return;
    }

    if (typeof val === 'bigint') {
      this.value = val * (10n ** BigInt(scale));
      return;
    }

    const strVal = typeof val === 'number' ? val.toFixed(scale) : String(val).trim();
    if (!/^-?\d+(\.\d+)?$/.test(strVal)) {
      throw new Error(`Invalid decimal value: "${val}"`);
    }

    const isNegative = strVal.startsWith('-');
    const cleanStr = isNegative ? strVal.slice(1) : strVal;
    const parts = cleanStr.split('.');
    const integerPart = parts[0] || '0';
    let fractionPart = parts[1] || '';

    if (fractionPart.length > scale) {
      // Round half-up to scale to preserve micro-precision without truncation loss
      const basePart = fractionPart.slice(0, scale);
      const nextDigit = fractionPart[scale];
      let bigNum = BigInt(integerPart + basePart);
      if (nextDigit && nextDigit >= '5') {
        bigNum += 1n;
      }
      this.value = isNegative ? -bigNum : bigNum;
      return;
    } else {
      fractionPart = fractionPart.padEnd(scale, '0');
    }

    const combinedStr = integerPart + fractionPart;
    const rawBig = BigInt(combinedStr);
    this.value = isNegative ? -rawBig : rawBig;
  }

  public static from(val: string | number | bigint | Decimal): Decimal {
    return new Decimal(val);
  }

  public static zero(): Decimal {
    return new Decimal(0);
  }

  public add(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    const sum = this.value + o.value;
    return this.createFromInternal(sum);
  }

  public sub(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    const diff = this.value - o.value;
    return this.createFromInternal(diff);
  }

  public mul(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    const product = (this.value * o.value) / Decimal.MULTIPLIER;
    return this.createFromInternal(product);
  }

  public div(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other : new Decimal(other);
    if (o.isZero()) {
      throw new Error('Division by zero in Decimal calculation');
    }
    const numerator = this.value * Decimal.MULTIPLIER;
    const quotient = numerator / o.value;
    return this.createFromInternal(quotient);
  }

  /**
   * Rounds the decimal to specific decimal places.
   * Defaults to HALF_UP per Article 61 of UAE Cabinet Decision No. 52/2017.
   */
  public round(decimalPlaces = 2, mode: RoundingMode = 'HALF_UP'): Decimal {
    if (decimalPlaces >= this.scale) {
      return this;
    }

    const diff = this.scale - decimalPlaces;
    const divisor = 10n ** BigInt(diff);
    const halfDivisor = divisor / 2n;

    const isNeg = this.value < 0n;
    const absVal = isNeg ? -this.value : this.value;

    let rounded: bigint;
    if (mode === 'HALF_UP') {
      // Article 61 Normal Rounding Basis: >= 0.5 rounds away from 0
      rounded = ((absVal + halfDivisor) / divisor) * divisor;
    } else if (mode === 'HALF_EVEN') {
      // Banker's Rounding: round to nearest even digit
      const rem = absVal % divisor;
      const base = (absVal / divisor) * divisor;
      if (rem > halfDivisor) {
        rounded = base + divisor;
      } else if (rem < halfDivisor) {
        rounded = base;
      } else {
        // Exactly half: round to even
        const lastDigit = (absVal / divisor) % 10n;
        rounded = lastDigit % 2n === 0n ? base : base + divisor;
      }
    } else if (mode === 'FLOOR') {
      rounded = (absVal / divisor) * divisor;
    } else if (mode === 'CEIL') {
      const rem = absVal % divisor;
      rounded = rem > 0n ? (absVal / divisor + 1n) * divisor : absVal;
    } else {
      rounded = ((absVal + halfDivisor) / divisor) * divisor;
    }

    const finalVal = isNeg ? -rounded : rounded;
    return this.createFromInternal(finalVal);
  }

  public abs(): Decimal {
    return this.createFromInternal(this.value < 0n ? -this.value : this.value);
  }

  public neg(): Decimal {
    return this.createFromInternal(-this.value);
  }

  public isZero(): boolean {
    return this.value === 0n;
  }

  public isNegative(): boolean {
    return this.value < 0n;
  }

  public isPositive(): boolean {
    return this.value > 0n;
  }

  public eq(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value === o.value;
  }

  public gt(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value > o.value;
  }

  public gte(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value >= o.value;
  }

  public lt(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value < o.value;
  }

  public lte(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other : new Decimal(other);
    return this.value <= o.value;
  }

  public toFixed(decimalPlaces = 2): string {
    const isNeg = this.value < 0n;
    
    // Round using statutory HALF_UP first
    const rounded = this.round(decimalPlaces, 'HALF_UP');
    const roundedAbs = rounded.value < 0n ? -rounded.value : rounded.value;

    const str = roundedAbs.toString().padStart(this.scale + 1, '0');
    const intPart = str.slice(0, str.length - this.scale) || '0';
    let fracPart = str.slice(str.length - this.scale);

    fracPart = fracPart.slice(0, decimalPlaces).padEnd(decimalPlaces, '0');

    const result = decimalPlaces > 0 ? `${intPart}.${fracPart}` : intPart;
    return isNeg && !rounded.isZero() ? `-${result}` : result;
  }

  public toNumber(): number {
    return parseFloat(this.toFixed(this.scale));
  }

  public toString(): string {
    return this.toFixed(2);
  }

  public toJSON(): string {
    return this.toFixed(2);
  }

  private createFromInternal(internalValue: bigint): Decimal {
    const d = new Decimal(0, this.scale);
    // @ts-expect-error setting readonly internal value
    d.value = internalValue;
    return d;
  }
}
