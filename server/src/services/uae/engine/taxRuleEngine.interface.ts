/**
 * UAE Tax Rule Engine Interface
 * Defines contracts for versioned calculation engines.
 */

import { UaeCanonicalInvoice } from '../models/canonicalInvoice.js';
import { RawInvoiceCalculationInput } from '../models/validationSchemas.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IUaeTaxRuleEngine {
  readonly version: string;
  readonly effectiveFromDate: string;
  readonly effectiveToDate?: string;

  /**
   * Calculates all line amounts, category tax breakdowns, dual-currency AED totals,
   * and invoice totals using exact Decimal arithmetic.
   */
  calculate(
    input: RawInvoiceCalculationInput,
    options?: { evaluationDate?: Date | string }
  ): UaeCanonicalInvoice;

  /**
   * Validates a canonical invoice against version-specific business rules.
   */
  validate(invoice: UaeCanonicalInvoice): ValidationResult;
}
