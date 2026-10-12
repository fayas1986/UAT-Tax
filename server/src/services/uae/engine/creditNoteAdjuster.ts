/**
 * UAE Credit & Debit Note Adjustment Engine
 * Compliant with Federal Decree-Law No. (8) of 2017 Art. 60, 62
 * and Cabinet Decision No. (52) of 2017 (Executive Regulations) Art. 60.
 *
 * Implements strict cumulative over-credit protection, dual-limit enforcement (Net & Tax),
 * duplicate submission rejection, concurrency validation, and atomic calculation guarantees.
 */

import { Decimal } from '../utils/decimal.js';

export type StatutoryAdjustmentReason = 
  | 'CANCELLATION'
  | 'DISCOUNT_OR_REBATE'
  | 'GOODS_RETURN'
  | 'PRICE_ADJUSTMENT'
  | 'CLERICAL_ERROR';

export interface PrecedingInvoiceReference {
  invoiceNumber: string;
  issueDate: string;           // YYYY-MM-DD
  uuid: string;
  totalExclusiveAmount: string; // Original net total
  totalVatAmount: string;       // Original tax total
  totalInclusiveAmount: string; // Original gross total
}

export interface AppliedCreditNoteRecord {
  creditNoteNumber: string;
  creditNoteIssueDate?: string;
  creditedNet: string | number | Decimal;
  creditedVat: string | number | Decimal;
  creditedGross?: string | number | Decimal;
}

export interface CreditNoteAdjustmentInput {
  creditNoteNumber: string;
  creditNoteIssueDate: string; // YYYY-MM-DD
  precedingInvoice: PrecedingInvoiceReference;
  reasonCode: StatutoryAdjustmentReason;
  reasonDescription: string;
  
  // Historical ledger of all previously accepted credit notes against this invoice
  previouslyAppliedCreditNotes?: AppliedCreditNoteRecord[];
  
  // Optimistic concurrency control: expected number of previously applied credit notes
  expectedPreviousCreditNoteCount?: number;

  adjustmentLines: Array<{
    lineId: string;
    itemName: string;
    quantityCredited: string | number;
    unitPrice: string | number;
    taxRatePercent: string | number; // 5.00 or 0.00
  }>;
}

export interface CreditNoteAdjustmentResult {
  isValid: boolean;
  errors: string[];
  creditNoteNumber: string;
  precedingInvoiceNumber: string;
  
  // Current Credit Note Amounts
  currentCreditedNet: Decimal;
  currentCreditedVat: Decimal;
  currentCreditedGross: Decimal;
  
  // Cumulative Totals (Previous + Current)
  cumulativeCreditedNet: Decimal;
  cumulativeCreditedVat: Decimal;
  cumulativeCreditedGross: Decimal;
  
  // Remaining Creditable Balances
  remainingNetBalance: Decimal;
  remainingVatBalance: Decimal;
  remainingGrossBalance: Decimal;
  isFullyCredited: boolean;
  
  // Backwards-compatible aliases
  creditedNetTotal: Decimal;
  creditedVatTotal: Decimal;
  creditedGrossTotal: Decimal;
  remainingOriginalBalance: Decimal;

  lineAdjustments: Array<{
    lineId: string;
    itemName: string;
    creditedNet: Decimal;
    creditedVat: Decimal;
    creditedGross: Decimal;
  }>;
}

export class CreditNoteAdjuster {
  /**
   * Validates and calculates a UAE Tax Credit Note adjustment.
   * Pure, deterministic, atomic function. If validation fails, no accounting state is mutated.
   */
  public static calculateAdjustment(input: CreditNoteAdjustmentInput): CreditNoteAdjustmentResult {
    const errors: string[] = [];

    // 1. Mandatory Preceding Invoice Verification
    if (!input.precedingInvoice || !input.precedingInvoice.invoiceNumber) {
      errors.push('Credit note must reference a valid preceding tax invoice number.');
    }

    if (!input.precedingInvoice?.issueDate) {
      errors.push('Credit note must reference preceding invoice issue date.');
    } else {
      const origDate = new Date(input.precedingInvoice.issueDate);
      const creditDate = new Date(input.creditNoteIssueDate);
      if (isNaN(origDate.getTime()) || isNaN(creditDate.getTime())) {
        errors.push('Invalid date format for preceding invoice or credit note.');
      } else if (creditDate < origDate) {
        errors.push(`Credit note date (${input.creditNoteIssueDate}) cannot precede original invoice date (${input.precedingInvoice.issueDate}).`);
      }
    }

    // 2. Duplicate Detection
    const previousCNs = input.previouslyAppliedCreditNotes || [];
    const isDuplicate = previousCNs.some(cn => cn.creditNoteNumber === input.creditNoteNumber);
    if (isDuplicate) {
      errors.push(`Duplicate credit note rejected: "${input.creditNoteNumber}" has already been applied against invoice "${input.precedingInvoice?.invoiceNumber}".`);
    }

    // 3. Concurrency Protection
    if (
      input.expectedPreviousCreditNoteCount !== undefined &&
      previousCNs.length !== input.expectedPreviousCreditNoteCount
    ) {
      errors.push(`Concurrency conflict: Expected ${input.expectedPreviousCreditNoteCount} prior credit notes, but found ${previousCNs.length}. Transaction aborted to prevent over-credit race conditions.`);
    }

    // 4. Mandatory Reason Verification
    if (!input.reasonCode) {
      errors.push('Credit note requires a statutory adjustment reasonCode.');
    }
    if (!input.reasonDescription || input.reasonDescription.trim().length < 5) {
      errors.push('Credit note requires a descriptive explanation of adjustment (minimum 5 characters).');
    }

    // 5. Line-by-Line Credit Calculation using Article 61 HALF_UP
    let currentCreditedNet = Decimal.zero();
    let currentCreditedVat = Decimal.zero();
    const lineAdjustments = [];

    for (const line of input.adjustmentLines || []) {
      const qty = new Decimal(line.quantityCredited);
      const price = new Decimal(line.unitPrice);
      const rate = new Decimal(line.taxRatePercent);

      if (qty.isNegative()) {
        errors.push(`Line ${line.lineId}: Credited quantity must be positive (reversal semantics derived from document type).`);
      }

      const lineNet = qty.mul(price).round(2, 'HALF_UP');
      const lineVat = lineNet.mul(rate).div(100).round(2, 'HALF_UP');
      const lineGross = lineNet.add(lineVat).round(2, 'HALF_UP');

      currentCreditedNet = currentCreditedNet.add(lineNet);
      currentCreditedVat = currentCreditedVat.add(lineVat);

      lineAdjustments.push({
        lineId: line.lineId,
        itemName: line.itemName,
        creditedNet: lineNet,
        creditedVat: lineVat,
        creditedGross: lineGross
      });
    }

    const currentCreditedGross = currentCreditedNet.add(currentCreditedVat);

    // 6. Cumulative Over-Credit Protection (Net, Tax & Gross Limits)
    let priorCreditedNet = Decimal.zero();
    let priorCreditedVat = Decimal.zero();
    let priorCreditedGross = Decimal.zero();

    for (const prior of previousCNs) {
      const net = new Decimal(prior.creditedNet);
      const vat = new Decimal(prior.creditedVat);
      const gross = prior.creditedGross ? new Decimal(prior.creditedGross) : net.add(vat);
      
      priorCreditedNet = priorCreditedNet.add(net);
      priorCreditedVat = priorCreditedVat.add(vat);
      priorCreditedGross = priorCreditedGross.add(gross);
    }

    const origNet = input.precedingInvoice?.totalExclusiveAmount 
      ? new Decimal(input.precedingInvoice.totalExclusiveAmount) 
      : Decimal.zero();
    const origVat = input.precedingInvoice?.totalVatAmount 
      ? new Decimal(input.precedingInvoice.totalVatAmount) 
      : Decimal.zero();
    const origGross = input.precedingInvoice?.totalInclusiveAmount 
      ? new Decimal(input.precedingInvoice.totalInclusiveAmount) 
      : origNet.add(origVat);

    const availableNet = origNet.sub(priorCreditedNet);
    const availableVat = origVat.sub(priorCreditedVat);
    const availableGross = origGross.sub(priorCreditedGross);

    // Enforce Net Limit
    if (currentCreditedNet.gt(availableNet)) {
      errors.push(`Credited net amount (${currentCreditedNet.toString()} AED) exceeds remaining net balance (${availableNet.toString()} AED) after ${previousCNs.length} previously applied credit note(s).`);
    }

    // Enforce Tax Limit
    if (currentCreditedVat.gt(availableVat)) {
      errors.push(`Credited VAT amount (${currentCreditedVat.toString()} AED) exceeds remaining VAT balance (${availableVat.toString()} AED) after ${previousCNs.length} previously applied credit note(s).`);
    }

    // Enforce Gross Limit
    if (currentCreditedGross.gt(availableGross)) {
      errors.push(`Credited gross amount (${currentCreditedGross.toString()} AED) exceeds remaining gross balance (${availableGross.toString()} AED) after ${previousCNs.length} previously applied credit note(s).`);
    }

    const isValid = errors.length === 0;

    // Atomic Balance Resolution
    const totalCumulativeNet = isValid ? priorCreditedNet.add(currentCreditedNet) : priorCreditedNet;
    const totalCumulativeVat = isValid ? priorCreditedVat.add(currentCreditedVat) : priorCreditedVat;
    const totalCumulativeGross = isValid ? priorCreditedGross.add(currentCreditedGross) : priorCreditedGross;

    const remainingNetBalance = origNet.sub(totalCumulativeNet).round(2, 'HALF_UP');
    const remainingVatBalance = origVat.sub(totalCumulativeVat).round(2, 'HALF_UP');
    const remainingGrossBalance = origGross.sub(totalCumulativeGross).round(2, 'HALF_UP');

    const isFullyCredited = isValid && remainingGrossBalance.isZero();

    return {
      isValid,
      errors,
      creditNoteNumber: input.creditNoteNumber,
      precedingInvoiceNumber: input.precedingInvoice?.invoiceNumber || '',
      currentCreditedNet,
      currentCreditedVat,
      currentCreditedGross,
      cumulativeCreditedNet: totalCumulativeNet,
      cumulativeCreditedVat: totalCumulativeVat,
      cumulativeCreditedGross: totalCumulativeGross,
      remainingNetBalance,
      remainingVatBalance,
      remainingGrossBalance,
      isFullyCredited,
      creditedNetTotal: currentCreditedNet,
      creditedVatTotal: currentCreditedVat,
      creditedGrossTotal: currentCreditedGross,
      remainingOriginalBalance: remainingGrossBalance,
      lineAdjustments
    };
  }
}
