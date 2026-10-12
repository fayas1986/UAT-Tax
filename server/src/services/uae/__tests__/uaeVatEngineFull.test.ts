/**
 * UAE VAT Engine & Statutory Verification Suite (Phase 2 Corrections)
 *
 * Verifies:
 * 1. Statutory Article 61 Half-Up Rounding boundaries (below, at, and above half-fils; negative amounts)
 * 2. Cumulative Credit Note over-credit protection (net/tax limits, multiple partial credits, exact zero balance, duplicate rejection, concurrency guards, atomic failure)
 * 3. VAT 201 Return directional aggregation (Sales vs Inward purchases, Domestic RCM Box 3 vs Outward RCM, Box 1a-1g, Boxes 8, 9, 10, 11, 14)
 */

import { describe, it, expect } from 'vitest';
import { UaeVatEngine2026 } from '../engine/uaeVatEngine.2026.js';
import { CreditNoteAdjuster } from '../engine/creditNoteAdjuster.js';
import {
  CreditNotePersistenceService,
  InMemoryTransactionalInvoiceStore,
  PrismaCreditNoteRepository
} from '../engine/creditNotePersistenceService.js';
import { Vat201Aggregator, Vat201TransactionInput } from '../reporting/vat201Aggregator.js';
import { Decimal } from '../utils/decimal.js';
import { RawInvoiceCalculationInput } from '../models/validationSchemas.js';

describe('UAE VAT Engine & Statutory Compliance Suite — Phase 2 Corrections', () => {
  const engine = new UaeVatEngine2026();

  const baseSeller = {
    name: 'Alwadi Enterprise UAE LLC',
    tin: '1004567890',
    participantId: '0235:1004567890',
    legalRegistration: { id: 'CN-1234567', type: 'TL' as const },
    address: {
      addressLine1: 'Business Bay Tower 1',
      city: 'Dubai',
      countrySubdivision: 'Dubai',
      countryCode: 'AE' as const
    }
  };

  const baseBuyer = {
    name: 'Emirates Distribution Co PJSC',
    tin: '1009876543',
    participantId: '0235:1009876543',
    legalRegistration: { id: 'CN-7654321', type: 'TL' as const },
    address: {
      addressLine1: 'Sheikh Zayed Road',
      city: 'Dubai',
      countrySubdivision: 'Dubai',
      countryCode: 'AE' as const
    }
  };

  // =========================================================================
  // 1. STATUTORY ARTICLE 61 ROUNDING SPECIFICATION & BOUNDARIES
  // =========================================================================
  describe('1. Statutory Article 61 Rounding Specification & Boundaries (HALF_UP)', () => {
    it('defines exact statutory normal rounding basis (HALF_UP, not banker\'s rounding)', () => {
      // UAE VAT Executive Regulations Article 61: >= 0.5 fils rounds up to next fils.
      // Crucial test: 2.345 AED under Banker's Rounding (HALF_EVEN) would round to 2.34 (even digit).
      // Under Article 61 HALF_UP, 2.345 MUST round to 2.35!
      const valBankersDivergence = new Decimal('2.345');
      expect(valBankersDivergence.round(2, 'HALF_UP').toString()).toBe('2.35');
      expect(valBankersDivergence.round(2, 'HALF_EVEN').toString()).toBe('2.34'); // Demonstrates difference
      expect(valBankersDivergence.toString()).toBe('2.35'); // Default is HALF_UP

      const valOddHalf = new Decimal('2.355');
      expect(valOddHalf.toString()).toBe('2.36');
    });

    it('correctly rounds fractions strictly below half a fils down', () => {
      // Below 0.5 fils (< 0.005 AED)
      expect(new Decimal('0.004').toString()).toBe('0.00');
      expect(new Decimal('0.0049').toString()).toBe('0.00');
      expect(new Decimal('1.664').toString()).toBe('1.66');
      expect(new Decimal('1.66499999').toString()).toBe('1.66');
      expect(new Decimal('100.124').toString()).toBe('100.12');
    });

    it('correctly rounds fractions exactly at half a fils up', () => {
      // Exactly 0.5 fils (= 0.005 AED)
      expect(new Decimal('0.005').toString()).toBe('0.01');
      expect(new Decimal('1.665').toString()).toBe('1.67');
      expect(new Decimal('33.33').mul(new Decimal('0.05')).toString()).toBe('1.67'); // 1.6665 -> 1.67
      expect(new Decimal('100.125').toString()).toBe('100.13');
    });

    it('correctly rounds fractions strictly above half a fils up', () => {
      // Above 0.5 fils (> 0.005 AED)
      expect(new Decimal('0.006').toString()).toBe('0.01');
      expect(new Decimal('1.666').toString()).toBe('1.67');
      expect(new Decimal('1.669').toString()).toBe('1.67');
      expect(new Decimal('100.126').toString()).toBe('100.13');
    });

    it('correctly rounds negative adjustment amounts (Credit Notes)', () => {
      // Negative amounts must preserve absolute magnitude HALF_UP with negative sign
      expect(new Decimal('-0.004').toString()).toBe('0.00');
      expect(new Decimal('-0.005').toString()).toBe('-0.01');
      expect(new Decimal('-1.664').toString()).toBe('-1.66');
      expect(new Decimal('-1.665').toString()).toBe('-1.67');
      expect(new Decimal('-2.345').toString()).toBe('-2.35'); // Not -2.34
      expect(new Decimal('-2.355').toString()).toBe('-2.36');
    });

    it('reconciles line-level VAT with document totals without floating-point error', () => {
      const input: RawInvoiceCalculationInput = {
        documentId: 'INV-ROUND-001',
        invoiceType: 'TAX_INVOICE',
        issueDate: '2026-10-15',
        dueDate: '2026-11-15',
        documentCurrencyCode: 'AED',
        transactionBitmask: '00000000',
        seller: baseSeller,
        buyer: baseBuyer,
        lines: [
          {
            lineId: '1',
            itemType: 'G',
            itemName: 'Item A',
            quantity: 3,
            unitPrice: 33.33, // Net = 99.99 AED, 5% = 4.9995 -> 5.00 AED
            unitOfMeasureCode: 'C62',
            taxCategoryCode: 'S'
          },
          {
            lineId: '2',
            itemType: 'G',
            itemName: 'Item B',
            quantity: 1,
            unitPrice: 16.67, // Net = 16.67 AED, 5% = 0.8335 -> 0.83 AED
            unitOfMeasureCode: 'C62',
            taxCategoryCode: 'S'
          }
        ]
      };

      const result = engine.calculate(input);
      expect(result.lines[0].lineNetAmount.toString()).toBe('99.99');
      expect(result.lines[0].taxAmount.toString()).toBe('5.00');
      expect(result.lines[1].lineNetAmount.toString()).toBe('16.67');
      expect(result.lines[1].taxAmount.toString()).toBe('0.83');

      // Category Subtotal: Taxable 116.66 AED, Tax = 116.66 * 5% = 5.833 -> 5.83 AED
      expect(result.taxExclusiveAmount.toString()).toBe('116.66');
      expect(result.totalTaxAmount.toString()).toBe('5.83');
      expect(result.taxInclusiveAmount.toString()).toBe('122.49');
      expect(result.taxInclusiveAmount.sub(result.taxExclusiveAmount).toString()).toBe(result.totalTaxAmount.toString());
    });
  });

  // =========================================================================
  // 2. CREDIT-NOTE CUMULATIVE OVER-CREDIT PROTECTION
  // =========================================================================
  describe('2. Credit-Note Cumulative Over-Credit Protection (CreditNoteAdjuster)', () => {
    const origInvoice = {
      invoiceNumber: 'INV-2026-ORIG-100',
      issueDate: '2026-10-01',
      uuid: 'uuid-orig-100',
      totalExclusiveAmount: '1000.00',
      totalVatAmount: '50.00',
      totalInclusiveAmount: '1050.00'
    };

    it('tracks multiple partial credit notes and enforces exact remaining balances', () => {
      // Step 1: First partial credit (30% = 300 Net, 15 VAT, 315 Gross)
      const cn1Result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-001',
        creditNoteIssueDate: '2026-10-05',
        precedingInvoice: origInvoice,
        reasonCode: 'GOODS_RETURN',
        reasonDescription: 'First partial return',
        previouslyAppliedCreditNotes: [],
        adjustmentLines: [
          { lineId: '1', itemName: 'Batch 1', quantityCredited: 1, unitPrice: 300, taxRatePercent: 5 }
        ]
      });

      expect(cn1Result.isValid).toBe(true);
      expect(cn1Result.currentCreditedNet.toString()).toBe('300.00');
      expect(cn1Result.currentCreditedVat.toString()).toBe('15.00');
      expect(cn1Result.remainingNetBalance.toString()).toBe('700.00');
      expect(cn1Result.remainingVatBalance.toString()).toBe('35.00');
      expect(cn1Result.remainingGrossBalance.toString()).toBe('735.00');
      expect(cn1Result.isFullyCredited).toBe(false);

      // Step 2: Second partial credit (40% = 400 Net, 20 VAT, 420 Gross) accounting for CN-001
      const cn2Result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-002',
        creditNoteIssueDate: '2026-10-10',
        precedingInvoice: origInvoice,
        reasonCode: 'PRICE_ADJUSTMENT',
        reasonDescription: 'Second partial price adjustment',
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '300.00', creditedVat: '15.00', creditedGross: '315.00' }
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'Batch 2', quantityCredited: 1, unitPrice: 400, taxRatePercent: 5 }
        ]
      });

      expect(cn2Result.isValid).toBe(true);
      expect(cn2Result.cumulativeCreditedNet.toString()).toBe('700.00');
      expect(cn2Result.cumulativeCreditedVat.toString()).toBe('35.00');
      expect(cn2Result.remainingNetBalance.toString()).toBe('300.00');
      expect(cn2Result.remainingVatBalance.toString()).toBe('15.00');
      expect(cn2Result.remainingGrossBalance.toString()).toBe('315.00');
      expect(cn2Result.isFullyCredited).toBe(false);

      // Step 3: Exact final remaining balance credit (300 Net, 15 VAT, 315 Gross)
      const cn3Result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-003',
        creditNoteIssueDate: '2026-10-15',
        precedingInvoice: origInvoice,
        reasonCode: 'CANCELLATION',
        reasonDescription: 'Final remaining balance cancellation',
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '300.00', creditedVat: '15.00', creditedGross: '315.00' },
          { creditNoteNumber: 'CN-002', creditedNet: '400.00', creditedVat: '20.00', creditedGross: '420.00' }
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'Final Remainder', quantityCredited: 1, unitPrice: 300, taxRatePercent: 5 }
        ]
      });

      expect(cn3Result.isValid).toBe(true);
      expect(cn3Result.cumulativeCreditedNet.toString()).toBe('1000.00');
      expect(cn3Result.cumulativeCreditedVat.toString()).toBe('50.00');
      expect(cn3Result.remainingNetBalance.toString()).toBe('0.00');
      expect(cn3Result.remainingVatBalance.toString()).toBe('0.00');
      expect(cn3Result.remainingGrossBalance.toString()).toBe('0.00');
      expect(cn3Result.isFullyCredited).toBe(true);
    });

    it('REJECTS credit note attempting to credit more than remaining net balance', () => {
      // Remaining net is 300.00, user attempts 301.00
      const result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-OVER-NET',
        creditNoteIssueDate: '2026-10-20',
        precedingInvoice: origInvoice,
        reasonCode: 'PRICE_ADJUSTMENT',
        reasonDescription: 'Excess net credit attempt',
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '700.00', creditedVat: '35.00', creditedGross: '735.00' }
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'Excess Item', quantityCredited: 1, unitPrice: 301, taxRatePercent: 5 }
        ]
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds remaining net balance'))).toBe(true);
      // Atomic state guarantee: Remaining balance is not corrupted on rejection
      expect(result.remainingNetBalance.toString()).toBe('300.00');
      expect(result.remainingGrossBalance.toString()).toBe('315.00');
    });

    it('REJECTS credit note attempting to credit more than remaining VAT balance', () => {
      // Zero net price but attempt high tax rate to exceed VAT balance
      const result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-OVER-VAT',
        creditNoteIssueDate: '2026-10-20',
        precedingInvoice: origInvoice,
        reasonCode: 'CLERICAL_ERROR',
        reasonDescription: 'Excess VAT credit attempt',
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '500.00', creditedVat: '45.00', creditedGross: '545.00' } // Only 5.00 VAT left
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'VAT Correction', quantityCredited: 1, unitPrice: 200, taxRatePercent: 5 } // 10.00 VAT > 5.00 left!
        ]
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds remaining VAT balance'))).toBe(true);
    });

    it('REJECTS duplicate credit note numbers against the same preceding invoice', () => {
      const result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-001', // Already applied!
        creditNoteIssueDate: '2026-10-20',
        precedingInvoice: origInvoice,
        reasonCode: 'GOODS_RETURN',
        reasonDescription: 'Resubmitted duplicate credit note',
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '200.00', creditedVat: '10.00', creditedGross: '210.00' }
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'Goods', quantityCredited: 1, unitPrice: 100, taxRatePercent: 5 }
        ]
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate credit note rejected'))).toBe(true);
    });

    it('REJECTS concurrent requests with optimistic concurrency count conflict', () => {
      // Expected 1 prior CN, but ledger contains 2 (another worker committed in between)
      const result = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: 'CN-RACE-003',
        creditNoteIssueDate: '2026-10-20',
        precedingInvoice: origInvoice,
        reasonCode: 'CANCELLATION',
        reasonDescription: 'Concurrent race test',
        expectedPreviousCreditNoteCount: 1,
        previouslyAppliedCreditNotes: [
          { creditNoteNumber: 'CN-001', creditedNet: '200.00', creditedVat: '10.00' },
          { creditNoteNumber: 'CN-002', creditedNet: '300.00', creditedVat: '15.00' }
        ],
        adjustmentLines: [
          { lineId: '1', itemName: 'Item', quantityCredited: 1, unitPrice: 100, taxRatePercent: 5 }
        ]
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Concurrency conflict'))).toBe(true);
    });
  });

  // =========================================================================
  // 3. VAT 201 REVERSE-CHARGE TREATMENT & DIRECTIONAL REPORTING
  // =========================================================================
  describe('3. FTA VAT 201 Return Directional Aggregation & Reverse Charge Treatment', () => {
    it('SELLER PERSPECTIVE: Does NOT include outward RCM sales in Box 3 or Output Tax Due', () => {
      // Under CD 91/2023: Seller supplies electronic devices under RCM (Category AE).
      // Supplier displays 0% VAT. Buyer accounts for VAT.
      // Supplier MUST NOT report this in Box 3 or add it to Box 8 Output Tax Due!
      const transactions: Vat201TransactionInput[] = [
        {
          transactionId: 'TX-DXB-01',
          documentId: 'INV-DXB-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-05',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 10000,
          vatAmountAed: 500
        },
        {
          transactionId: 'TX-AUH-01',
          documentId: 'INV-AUH-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-10',
          emirate: 'Abu Dhabi',
          taxCategoryCode: 'S',
          netAmountAed: 20000,
          vatAmountAed: 1000
        },
        {
          transactionId: 'TX-RCM-OUT-01',
          documentId: 'INV-RCM-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-15',
          emirate: 'Dubai',
          taxCategoryCode: 'AE', // Outward RCM Sale
          netAmountAed: 50000,
          vatAmountAed: 0
        }
      ];

      const report = Vat201Aggregator.aggregateTransactions(transactions, {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        trn: '100456789012345',
        companyName: 'Alwadi Enterprise UAE LLC'
      });

      // Box 1a (Abu Dhabi): 20,000 Net, 1,000 VAT
      expect(report.box1a_AbuDhabi.taxableAmountAed.toString()).toBe('20000.00');
      expect(report.box1a_AbuDhabi.vatAmountAed.toString()).toBe('1000.00');

      // Box 1b (Dubai): 10,000 Net, 500 VAT (RCM sale not included here)
      expect(report.box1b_Dubai.taxableAmountAed.toString()).toBe('10000.00');
      expect(report.box1b_Dubai.vatAmountAed.toString()).toBe('500.00');

      // Total Box 1 Standard Rated: 30,000 Net, 1,500 VAT
      expect(report.box1_TotalStandardRatedTaxableAed.toString()).toBe('30000.00');
      expect(report.box1_TotalStandardRatedVatAed.toString()).toBe('1500.00');

      // Crucial Test: Box 3 must be 0.00 because supplier does not account for RCM output VAT!
      expect(report.box3_ReverseChargeTaxableAed.toString()).toBe('0.00');
      expect(report.box3_ReverseChargeVatAed.toString()).toBe('0.00');

      // Reconciled in supplier informational total
      expect(report.supplierOutwardRcmSalesAed.toString()).toBe('50000.00');

      // Box 8 Output Tax Due must strictly equal Box 1 VAT (1,500 AED), NOT polluted by RCM!
      expect(report.box8_TotalOutputTaxDueAed.toString()).toBe('1500.00');
      expect(report.totalOutputTaxDueAed.toString()).toBe('1500.00');
    });

    it('BUYER PERSPECTIVE: Declares Inward RCM in Box 3 and recovers Input Tax in Box 10', () => {
      // Taxpayer receives electronic devices under RCM (Category AE) as BUYER.
      // Inward RCM Supply: 50,000 AED Net.
      // Box 3: 50,000 Taxable, 2,500 Output VAT accounted for by buyer.
      // Box 10: 2,500 Recoverable Input VAT.
      // Plus standard business expenses: 20,000 AED Net, 1,000 AED VAT in Box 9.
      const transactions: Vat201TransactionInput[] = [
        {
          transactionId: 'TX-EXPENSE-01',
          documentId: 'BILL-001',
          documentType: 'EXPENSE_INVOICE',
          direction: 'PURCHASE_INPUT',
          issueDate: '2026-10-05',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 20000,
          vatAmountAed: 1000,
          inputTaxRecoveryPercent: 100
        },
        {
          transactionId: 'TX-RCM-IN-01',
          documentId: 'BILL-RCM-01',
          documentType: 'EXPENSE_INVOICE',
          direction: 'PURCHASE_INPUT',
          issueDate: '2026-10-12',
          emirate: 'Dubai',
          taxCategoryCode: 'AE', // Inward RCM Purchase
          netAmountAed: 50000,
          vatAmountAed: 0,
          inputTaxRecoveryPercent: 100
        }
      ];

      const report = Vat201Aggregator.aggregateTransactions(transactions, {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        trn: '100456789012345',
        companyName: 'Alwadi Enterprise UAE LLC'
      });

      // Box 3 (Reverse Charge Inward): 50,000 Taxable, 2,500 Output Tax
      expect(report.box3_ReverseChargeTaxableAed.toString()).toBe('50000.00');
      expect(report.box3_ReverseChargeVatAed.toString()).toBe('2500.00');

      // Box 8 (Total Output Tax Due): 2,500.00 AED
      expect(report.box8_TotalOutputTaxDueAed.toString()).toBe('2500.00');

      // Box 9 (Standard Rated Expenses): 20,000 Taxable, 1,000 Recoverable VAT
      expect(report.box9_StandardRatedExpensesTaxableAed.toString()).toBe('20000.00');
      expect(report.box9_StandardRatedExpensesRecoverableVatAed.toString()).toBe('1000.00');

      // Box 10 (RCM Input Tax Recovery): 2,500.00 AED
      expect(report.box10_ReverseChargeRecoverableVatAed.toString()).toBe('2500.00');

      // Box 11 (Total Recoverable Tax): 1,000 + 2,500 = 3,500.00 AED
      expect(report.box11_TotalRecoverableTaxAed.toString()).toBe('3500.00');

      // Box 14 (Net VAT Payable/Refundable): 2,500 (Due) - 3,500 (Recoverable) = -1,000.00 AED (Refundable)
      expect(report.box14_NetPayableTaxAed.toString()).toBe('-1000.00');
    });

    it('CORRECTLY APPLIES CREDIT NOTE ADJUSTMENTS in Box 1 Adjustments column', () => {
      // 100,000 AED Dubai sale, followed by 20,000 AED Credit Note adjustment
      const transactions: Vat201TransactionInput[] = [
        {
          transactionId: 'TX-INV-01',
          documentId: 'INV-DXB-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-01',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 100000,
          vatAmountAed: 5000
        },
        {
          transactionId: 'TX-CN-01',
          documentId: 'CN-DXB-01',
          documentType: 'TAX_CREDIT_NOTE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-15',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 20000,
          vatAmountAed: 1000
        }
      ];

      const report = Vat201Aggregator.aggregateTransactions(transactions, {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        trn: '100456789012345',
        companyName: 'Alwadi Enterprise UAE LLC'
      });

      // Box 1b (Dubai):
      // Taxable Sales adjusted: 100,000 - 20,000 = 80,000 AED
      // Gross VAT: 5,000 AED, Adjustments: -1,000 AED
      expect(report.box1b_Dubai.taxableAmountAed.toString()).toBe('80000.00');
      expect(report.box1b_Dubai.vatAmountAed.toString()).toBe('5000.00');
      expect(report.box1b_Dubai.adjustmentsAed.toString()).toBe('-1000.00');

      // Net Box 8 Output Tax Due: 5000 - 1000 = 4000.00 AED
      expect(report.box8_TotalOutputTaxDueAed.toString()).toBe('4000.00');
      expect(report.box14_NetPayableTaxAed.toString()).toBe('4000.00');
    });

    it('CORRECTLY APPLIES BOX 2 TOURIST REFUND as a deduction reducing Box 8 Output Tax Due', () => {
      // 50,000 AED Dubai sales (2,500 AED VAT)
      // Minus 400 AED VAT refunded to tourists under the Tourist Refund Scheme
      const transactions: Vat201TransactionInput[] = [
        {
          transactionId: 'TX-DXB-RETAIL',
          documentId: 'INV-DXB-RETAIL-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-05',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 50000,
          vatAmountAed: 2500
        },
        {
          transactionId: 'TX-TOURIST-REFUND-01',
          documentId: 'REF-TOURIST-01',
          documentType: 'COMMERCIAL_INVOICE',
          direction: 'SALES_OUTPUT',
          nature: 'TOURIST_REFUND',
          issueDate: '2026-10-08',
          emirate: 'Dubai',
          taxCategoryCode: 'O',
          netAmountAed: 8000,
          vatAmountAed: 400 // 400 AED refunded to tourists
        }
      ];

      const report = Vat201Aggregator.aggregateTransactions(transactions, {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        trn: '100456789012345',
        companyName: 'Alwadi Enterprise UAE LLC'
      });

      // Box 1 VAT: 2,500 AED
      expect(report.box1b_Dubai.vatAmountAed.toString()).toBe('2500.00');
      // Box 2 Tourist Refund VAT: 400 AED
      expect(report.box2_TouristRefundVatAed.toString()).toBe('400.00');
      // Crucial Sign Convention: Box 8 = Box 1 VAT (2500) - Box 2 Tourist Refund (400) = 2,100 AED
      expect(report.box8_TotalOutputTaxDueAed.toString()).toBe('2100.00');
    });

    it('CORRECTLY AGGREGATES BOX 6 CUSTOMS IMPORTS AND BOX 7 ADJUSTMENTS into Box 8', () => {
      // 100,000 AED Dubai sales (5,000 AED VAT)
      // Plus 40,000 AED Customs imports (Box 6: 2,000 AED VAT)
      // Minus 200 AED downward customs adjustment (Box 7)
      const transactions: Vat201TransactionInput[] = [
        {
          transactionId: 'TX-SALES-01',
          documentId: 'INV-DXB-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          issueDate: '2026-10-05',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 100000,
          vatAmountAed: 5000
        },
        {
          transactionId: 'TX-CUSTOMS-01',
          documentId: 'DEC-CUSTOMS-01',
          documentType: 'TAX_INVOICE',
          direction: 'SALES_OUTPUT',
          nature: 'CUSTOMS_IMPORT',
          issueDate: '2026-10-06',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 40000,
          vatAmountAed: 2000
        },
        {
          transactionId: 'TX-CUSTOMS-ADJ-01',
          documentId: 'ADJ-CUSTOMS-01',
          documentType: 'TAX_CREDIT_NOTE', // Downward adjustment
          direction: 'SALES_OUTPUT',
          nature: 'CUSTOMS_IMPORT_ADJUSTMENT',
          issueDate: '2026-10-07',
          emirate: 'Dubai',
          taxCategoryCode: 'S',
          netAmountAed: 4000,
          vatAmountAed: 200
        }
      ];

      const report = Vat201Aggregator.aggregateTransactions(transactions, {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        trn: '100456789012345',
        companyName: 'Alwadi Enterprise UAE LLC'
      });

      expect(report.box6_ImportedGoodsTaxableAed.toString()).toBe('40000.00');
      expect(report.box6_ImportedGoodsVatAed.toString()).toBe('2000.00');
      expect(report.box7_ImportedGoodsAdjustmentsVatAed.toString()).toBe('-200.00');
      // Box 8 = 5000 (Box 1) + 2000 (Box 6) - 200 (Box 7) = 6,800 AED
      expect(report.box8_TotalOutputTaxDueAed.toString()).toBe('6800.00');
    });
  });

  // =========================================================================
  // 4. ATOMIC PERSISTENCE & CONCURRENT OVER-CREDIT PROTECTION
  // =========================================================================
  describe('4. Atomic Persistence & Concurrent Over-Credit Protection (CreditNotePersistenceService)', () => {
    it('prevents concurrent credit-note requests from exceeding the remaining balance', async () => {
      const store = new InMemoryTransactionalInvoiceStore();
      const persistenceService = new CreditNotePersistenceService(store);

      // Seed an invoice with 1,000 AED Net, 50 AED VAT, 1,050 AED Gross
      store.seedInvoice({
        invoiceNumber: 'INV-CONCUR-001',
        issueDate: '2026-10-01',
        uuid: 'uuid-concur-001',
        totalExclusiveAmount: '1000.00',
        totalVatAmount: '50.00',
        totalInclusiveAmount: '1050.00',
        remainingExclusiveBalance: '1000.00',
        remainingVatBalance: '50.00',
        remainingInclusiveBalance: '1050.00',
        version: 1,
        appliedCreditNotes: []
      });

      // Two concurrent requests both try to credit 600.00 AED net (60% each, total 1200 > 1000)
      const req1 = persistenceService.processCreditNoteAdjustment({
        invoiceNumber: 'INV-CONCUR-001',
        creditNoteNumber: 'CN-CONCUR-A',
        creditNoteIssueDate: '2026-10-15',
        reasonCode: 'GOODS_RETURN',
        reasonDescription: 'Concurrent Request A',
        adjustmentLines: [
          { lineId: '1', itemName: 'Batch A', quantityCredited: 1, unitPrice: 600, taxRatePercent: 5 }
        ]
      });

      const req2 = persistenceService.processCreditNoteAdjustment({
        invoiceNumber: 'INV-CONCUR-001',
        creditNoteNumber: 'CN-CONCUR-B',
        creditNoteIssueDate: '2026-10-15',
        reasonCode: 'GOODS_RETURN',
        reasonDescription: 'Concurrent Request B',
        adjustmentLines: [
          { lineId: '1', itemName: 'Batch B', quantityCredited: 1, unitPrice: 600, taxRatePercent: 5 }
        ]
      });

      const [res1, res2] = await Promise.all([req1, req2]);

      // Exactly ONE must succeed and exactly ONE must fail with balance exceeded
      const results = [res1, res2];
      const successful = results.filter(r => r.isValid);
      const rejected = results.filter(r => !r.isValid);

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify the successful one credited 600 AED Net, 30 AED VAT
      expect(successful[0].currentCreditedNet.toString()).toBe('600.00');
      expect(successful[0].currentCreditedVat.toString()).toBe('30.00');

      // Verify the rejected one reported balance exceeded
      expect(rejected[0].errors.some(e => e.includes('exceeds remaining net balance'))).toBe(true);

      // Verify stored persistent state in database
      const finalInvoice = store.getInvoice('INV-CONCUR-001')!;
      expect(finalInvoice.appliedCreditNotes).toHaveLength(1);
      expect(finalInvoice.remainingExclusiveBalance).toBe('400.00'); // 1000 - 600 = 400
      expect(finalInvoice.remainingVatBalance).toBe('20.00'); // 50 - 30 = 20
      expect(finalInvoice.remainingInclusiveBalance).toBe('420.00'); // 1050 - 630 = 420
      expect(finalInvoice.version).toBe(2);
    });

    it('POSTGRESQL PRISMA INTEGRATION: two concurrent transactions serialize under row lock, only one consumes balance, and ledger is correct', async () => {
      class ConcurrentPostgresPrismaMock {
        private invoiceRows: Map<string, any[]> = new Map();
        private creditNotes: any[] = [];
        private activeLocks: Map<string, { txId: string; release: () => void }> = new Map();
        private txCounter = 0;
        public txLogs: Array<{ txId: string; action: string; query?: string }> = [];

        public seedInvoice(row: any) {
          const list = this.invoiceRows.get(row.invoice_number) || [];
          list.push({ ...row });
          this.invoiceRows.set(row.invoice_number, list);
        }

        public getInvoice(invoiceNumber: string) {
          const list = this.invoiceRows.get(invoiceNumber);
          return list ? list[0] : undefined;
        }

        public getCreditNotes(invoiceNumber: string) {
          return this.creditNotes.filter(cn => cn.precedingInvoiceNumber === invoiceNumber);
        }

        public async $transaction<T>(fn: (tx: any) => Promise<T>, options?: any): Promise<T> {
          const txId = `tx_${++this.txCounter}`;
          this.txLogs.push({ txId, action: 'BEGIN_TRANSACTION' });

          let lockedInvoice: string | null = null;

          const scopedTx = {
            _txId: txId,
            $queryRawUnsafe: async (sql: string, ...params: any[]) => {
              this.txLogs.push({ txId, action: 'QUERY', query: sql });
              if (sql.includes('FOR UPDATE')) {
                const invNum = params[0];
                // Row locking wait loop
                while (this.activeLocks.has(invNum) && this.activeLocks.get(invNum)?.txId !== txId) {
                  await new Promise(resolve => setTimeout(resolve, 20));
                }
                if (!this.activeLocks.has(invNum)) {
                  let releaseLock!: () => void;
                  const lockPromise = new Promise<void>(r => { releaseLock = r; });
                  this.activeLocks.set(invNum, { txId, release: releaseLock });
                  lockedInvoice = invNum;
                }
                const list = this.invoiceRows.get(invNum) || [];
                return list.map(r => ({
                  id: r.id,
                  invoiceNumber: r.invoice_number,
                  issueDate: r.issue_date,
                  uuid: r.uuid,
                  totalExclusiveAmount: r.total_exclusive_amount,
                  totalVatAmount: r.total_vat_amount,
                  totalInclusiveAmount: r.total_inclusive_amount,
                  remainingExclusiveBalance: r.remaining_exclusive_balance,
                  remainingVatBalance: r.remaining_vat_balance,
                  remainingInclusiveBalance: r.remaining_inclusive_balance,
                  version: r.version
                }));
              }
              return [];
            },
            creditNote: {
              findMany: async (args: any) => {
                this.txLogs.push({ txId, action: 'creditNote.findMany' });
                return this.creditNotes.filter(cn => cn.precedingInvoiceNumber === args?.where?.precedingInvoiceNumber);
              },
              create: async (args: any) => {
                this.txLogs.push({ txId, action: 'creditNote.create' });
                this.creditNotes.push(args.data);
                return args.data;
              }
            },
            $executeRawUnsafe: async (sql: string, ...params: any[]) => {
              this.txLogs.push({ txId, action: 'EXECUTE', query: sql });
              if (sql.includes('UPDATE "invoices"')) {
                const invNum = params[4];
                const list = this.invoiceRows.get(invNum);
                if (list && list[0]) {
                  list[0].remaining_exclusive_balance = params[0];
                  list[0].remaining_vat_balance = params[1];
                  list[0].remaining_inclusive_balance = params[2];
                  list[0].version = params[3];
                }
              }
              return 1;
            }
          };

          try {
            const res = await fn(scopedTx);
            this.txLogs.push({ txId, action: 'COMMIT' });
            return res;
          } catch (err) {
            this.txLogs.push({ txId, action: 'ROLLBACK' });
            throw err;
          } finally {
            if (lockedInvoice && this.activeLocks.get(lockedInvoice)?.txId === txId) {
              const lockObj = this.activeLocks.get(lockedInvoice);
              this.activeLocks.delete(lockedInvoice);
              lockObj?.release();
            }
          }
        }
      }

      const prismaClient = new ConcurrentPostgresPrismaMock();
      prismaClient.seedInvoice({
        id: 1,
        invoice_number: 'INV-PRISMA-CONCUR-001',
        issue_date: '2026-10-01',
        uuid: 'uuid-prisma-001',
        total_exclusive_amount: '1000.00',
        total_vat_amount: '50.00',
        total_inclusive_amount: '1050.00',
        remaining_exclusive_balance: '1000.00',
        remaining_vat_balance: '50.00',
        remaining_inclusive_balance: '1050.00',
        version: 1
      });

      const repository = new PrismaCreditNoteRepository(prismaClient);
      const persistenceService = new CreditNotePersistenceService(repository);

      // Two concurrent requests both try to credit 600 AED net
      const req1 = persistenceService.processCreditNoteAdjustment({
        invoiceNumber: 'INV-PRISMA-CONCUR-001',
        creditNoteNumber: 'CN-PRISMA-A',
        creditNoteIssueDate: '2026-10-15',
        reasonCode: 'PRICE_ADJUSTMENT',
        reasonDescription: 'Concurrent worker 1',
        adjustmentLines: [{ lineId: '1', itemName: 'Batch A', quantityCredited: 1, unitPrice: 600, taxRatePercent: 5 }]
      });

      const req2 = persistenceService.processCreditNoteAdjustment({
        invoiceNumber: 'INV-PRISMA-CONCUR-001',
        creditNoteNumber: 'CN-PRISMA-B',
        creditNoteIssueDate: '2026-10-15',
        reasonCode: 'PRICE_ADJUSTMENT',
        reasonDescription: 'Concurrent worker 2',
        adjustmentLines: [{ lineId: '1', itemName: 'Batch B', quantityCredited: 1, unitPrice: 600, taxRatePercent: 5 }]
      });

      const [res1, res2] = await Promise.all([req1, req2]);
      const successful = [res1, res2].filter(r => r.isValid);
      const rejected = [res1, res2].filter(r => !r.isValid);

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].errors[0]).toContain('exceeds remaining net balance (400.00 AED)');

      // Verify the final persisted database ledger
      const finalDbInvoice = prismaClient.getInvoice('INV-PRISMA-CONCUR-001');
      expect(finalDbInvoice.remaining_exclusive_balance).toBe('400.00');
      expect(finalDbInvoice.remaining_vat_balance).toBe('20.00');
      expect(finalDbInvoice.remaining_inclusive_balance).toBe('420.00');
      expect(finalDbInvoice.version).toBe(2);

      const dbCreditNotes = prismaClient.getCreditNotes('INV-PRISMA-CONCUR-001');
      expect(dbCreditNotes).toHaveLength(1);
      expect(dbCreditNotes[0].creditedNet).toBe('600.00');

      // Verify all steps occurred within the SAME transaction (tx)
      const winningTxId = prismaClient.txLogs.find(l => l.action === 'creditNote.create')?.txId;
      expect(winningTxId).toBeDefined();

      const winningTxLogs = prismaClient.txLogs.filter(l => l.txId === winningTxId);
      const hasBegin = winningTxLogs.some(l => l.action === 'BEGIN_TRANSACTION');
      const hasRowLock = winningTxLogs.some(l => l.action === 'QUERY' && l.query?.includes('FOR UPDATE'));
      const hasLedgerRead = winningTxLogs.some(l => l.action === 'creditNote.findMany');
      const hasCreate = winningTxLogs.some(l => l.action === 'creditNote.create');
      const hasUpdate = winningTxLogs.some(l => l.action === 'EXECUTE' && l.query?.includes('UPDATE "invoices"'));
      const hasCommit = winningTxLogs.some(l => l.action === 'COMMIT');

      expect(hasBegin).toBe(true);
      expect(hasRowLock).toBe(true);
      expect(hasLedgerRead).toBe(true);
      expect(hasCreate).toBe(true);
      expect(hasUpdate).toBe(true);
      expect(hasCommit).toBe(true);
    });

    it('REJECTS when invoice identity uniqueness is violated (multiple rows for same invoice number)', async () => {
      const mockPrisma = {
        $transaction: async (fn: any) => {
          const fakeTx = {
            $queryRawUnsafe: async () => [
              { id: 1, invoiceNumber: 'INV-DUP-01', issueDate: '2026-10-01', uuid: 'u1' },
              { id: 2, invoiceNumber: 'INV-DUP-01', issueDate: '2026-10-01', uuid: 'u2' }
            ]
          };
          return await fn(fakeTx);
        }
      };
      const repo = new PrismaCreditNoteRepository(mockPrisma);
      await expect(
        repo.withInvoiceLock('INV-DUP-01', async () => {})
      ).rejects.toThrow(/Invoice identity uniqueness violation: multiple rows found for invoice "INV-DUP-01"/);
    });

    it('PREVENTS persistCreditNoteAdjustment from executing outside an active transaction', async () => {
      const repo = new PrismaCreditNoteRepository({});
      await expect(
        repo.persistCreditNoteAdjustment(
          'INV-001',
          { creditNoteNumber: 'CN-1', creditNoteIssueDate: '2026-10-01', creditedNet: '100', creditedVat: '5' },
          { remainingNet: new Decimal(900), remainingVat: new Decimal(45), remainingGross: new Decimal(945), newVersion: 2 }
        )
      ).rejects.toThrow(/Transactional integrity violation: persistCreditNoteAdjustment must execute within the active database transaction/);
    });
  });

  // =========================================================================
  // 5. AUDIT PROVENANCE, FX DATE VALIDATION & HISTORICAL REPRODUCIBILITY
  // =========================================================================
  describe('5. Audit Provenance, FX Date Validation & Historical Reproducibility', () => {
    it('preserves exchange-rate source, timestamp and calculation precision on canonical invoice', () => {
      // Corrected: Supply date and rate source date set to synchronous historical date (2026-10-10) <= current evaluation date (2026-10-12)
      const result = engine.calculate({
        documentId: 'INV-AUDIT-001',
        invoiceType: 'TAX_INVOICE',
        issueDate: '2026-10-10',
        supplyDate: '2026-10-10',
        dueDate: '2026-11-10',
        documentCurrencyCode: 'EUR',
        exchangeRateToAed: 4.025,
        exchangeRateSourceDate: '2026-10-10T09:00:00Z',
        transactionBitmask: '00000000',
        seller: baseSeller,
        buyer: baseBuyer,
        lines: [
          {
            lineId: '1',
            itemType: 'G',
            itemName: 'Machinery',
            quantity: 1,
            unitPrice: 1000,
            unitOfMeasureCode: 'C62',
            taxCategoryCode: 'S'
          }
        ]
      });

      expect(result.calculationAuditTrail).toBeDefined();
      expect(result.calculationAuditTrail?.statutoryRule).toBe('ARTICLE_61_HALF_UP');
      expect(result.calculationAuditTrail?.internalScalePrecision).toBe(8);
      expect(result.calculationAuditTrail?.fxSource).toBe('CBUAE');
      expect(result.calculationAuditTrail?.fxSourceDate).toBe('2026-10-10T09:00:00Z');
      expect(result.calculationAuditTrail?.fxRateApplied?.toFixed(3)).toBe('4.025');
      expect(result.calculationAuditTrail?.calculationTimestamp).toBeDefined();
    });

    it('REJECTS exchange rate source date that is in the future relative to current time', () => {
      expect(() => {
        engine.calculate({
          documentId: 'INV-FUTURE-FX-001',
          invoiceType: 'TAX_INVOICE',
          issueDate: '2026-10-10',
          dueDate: '2026-11-10',
          documentCurrencyCode: 'USD',
          exchangeRateToAed: 3.6725,
          exchangeRateSourceDate: '2026-11-20T00:00:00Z', // Far in future!
          transactionBitmask: '00000000',
          seller: baseSeller,
          buyer: baseBuyer,
          lines: [
            { lineId: '1', itemType: 'G', itemName: 'Item', quantity: 1, unitPrice: 100, unitOfMeasureCode: 'C62', taxCategoryCode: 'S' }
          ]
        });
      }).toThrow(/Exchange rate source date .* cannot be in the future/);
    });

    it('REJECTS exchange rate source date that is after the supply date under Article 69', () => {
      expect(() => {
        engine.calculate({
          documentId: 'INV-FUTURE-SUPPLY-FX-001',
          invoiceType: 'TAX_INVOICE',
          issueDate: '2026-08-01',
          supplyDate: '2026-08-01', // Supply happened August 1
          dueDate: '2026-09-01',
          documentCurrencyCode: 'USD',
          exchangeRateToAed: 3.6725,
          exchangeRateSourceDate: '2026-08-15T00:00:00Z', // Rate is from August 15 (> August 1)
          transactionBitmask: '00000000',
          seller: baseSeller,
          buyer: baseBuyer,
          lines: [
            { lineId: '1', itemType: 'G', itemName: 'Item', quantity: 1, unitPrice: 100, unitOfMeasureCode: 'C62', taxCategoryCode: 'S' }
          ]
        });
      }).toThrow(/cannot be in the future relative to invoice supply date.*under UAE VAT Law Article 69/);
    });

    it('guarantees deterministic historical calculation reproducibility', () => {
      // Historical transaction from 2026-05-15
      const historicalInput: RawInvoiceCalculationInput = {
        documentId: 'INV-HIST-2026-05-001',
        invoiceType: 'TAX_INVOICE',
        issueDate: '2026-05-15',
        supplyDate: '2026-05-15',
        dueDate: '2026-06-15',
        documentCurrencyCode: 'USD',
        exchangeRateToAed: 3.6725,
        exchangeRateSourceDate: '2026-05-15T08:00:00Z',
        transactionBitmask: '00000000',
        seller: baseSeller,
        buyer: baseBuyer,
        lines: [
          { lineId: '1', itemType: 'G', itemName: 'Batch A', quantity: 2, unitPrice: 500, unitOfMeasureCode: 'C62', taxCategoryCode: 'S' },
          { lineId: '2', itemType: 'G', itemName: 'Batch B', quantity: 1, unitPrice: 33.33, unitOfMeasureCode: 'C62', taxCategoryCode: 'S' }
        ]
      };

      // Running calculation twice yields identical amounts to the exact fils
      const run1 = engine.calculate(historicalInput);
      const run2 = engine.calculate(historicalInput);

      expect(run1.taxExclusiveAmount.toString()).toBe('1033.33');
      expect(run1.totalTaxAmount.toString()).toBe('51.67');
      expect(run1.totalVatAmountAed.toString()).toBe('189.76'); // 51.67 * 3.6725 = 189.758075 -> 189.76
      expect(run1.totalPayableAmountAed.toString()).toBe('3984.66'); // 1085 * 3.6725 = 3984.6625 -> 3984.66

      expect(run1.taxExclusiveAmount.toString()).toBe(run2.taxExclusiveAmount.toString());
      expect(run1.totalTaxAmount.toString()).toBe(run2.totalTaxAmount.toString());
      expect(run1.totalVatAmountAed.toString()).toBe(run2.totalVatAmountAed.toString());
      expect(run1.totalPayableAmountAed.toString()).toBe(run2.totalPayableAmountAed.toString());
    });

    it('supports clock injection and evaluationDate option for strict temporal validation', () => {
      // 1. Injected historical clock: October 1, 2026
      const historicalClock = () => new Date('2026-10-01T12:00:00Z');
      const engineWithClock = new UaeVatEngine2026(historicalClock);

      const baseInput: RawInvoiceCalculationInput = {
        documentId: 'INV-CLOCK-001',
        invoiceType: 'TAX_INVOICE',
        issueDate: '2026-10-01',
        supplyDate: '2026-10-01',
        dueDate: '2026-10-31',
        documentCurrencyCode: 'USD',
        exchangeRateToAed: 3.6725,
        exchangeRateSourceDate: '2026-10-01T08:00:00Z',
        transactionBitmask: '00000000',
        seller: baseSeller,
        buyer: baseBuyer,
        lines: [
          { lineId: '1', itemType: 'G', itemName: 'Item A', quantity: 1, unitPrice: 100, unitOfMeasureCode: 'C62', taxCategoryCode: 'S' }
        ]
      };

      // A. Rate dated before or at evaluation timestamp -> SUCCEEDS
      const successResult = engineWithClock.calculate(baseInput);
      expect(successResult.calculationAuditTrail?.calculationTimestamp).toBe('2026-10-01T12:00:00.000Z');
      expect(successResult.calculationAuditTrail?.fxSourceDate).toBe('2026-10-01T08:00:00Z');

      // B. Rate dated AFTER evaluation timestamp -> REJECTED
      expect(() => {
        engineWithClock.calculate({
          ...baseInput,
          exchangeRateSourceDate: '2026-10-05T00:00:00Z', // After Oct 1
          supplyDate: '2026-10-05'
        });
      }).toThrow(/cannot be in the future relative to evaluation date/);

      // C. Override evaluationDate per-calculation invocation
      const customEvalResult = engine.calculate(
        {
          ...baseInput,
          issueDate: '2025-06-15',
          supplyDate: '2025-06-15',
          exchangeRateSourceDate: '2025-06-15T09:00:00Z'
        },
        { evaluationDate: '2025-06-15T18:00:00Z' }
      );
      expect(customEvalResult.calculationAuditTrail?.calculationTimestamp).toBe('2025-06-15T18:00:00.000Z');
    });
  });
});
