/**
 * UAE FTA VAT 201 Return Aggregator
 * Compliant with Federal Tax Authority (FTA) VAT 201 Return Requirements,
 * Federal Decree-Law No. (8) of 2017, Cabinet Decision No. (52) of 2017,
 * and Cabinet Decision No. (91) of 2023 on Domestic Reverse Charge.
 *
 * Implements strict separation of Sales (Outputs), Purchases (Inputs),
 * and Reverse Charge directionality (Supplier outward vs Recipient inward).
 */

import { Decimal } from '../utils/decimal.js';
import { UaeCanonicalInvoice, UaeEmirate } from '../models/canonicalInvoice.js';

export type TransactionDirection = 'SALES_OUTPUT' | 'PURCHASE_INPUT';

export interface EmirateSupplyBreakdown {
  emirate: UaeEmirate;
  taxableAmountAed: Decimal;
  vatAmountAed: Decimal;
  adjustmentsAed: Decimal;
}

export type Vat201TransactionNature = 
  | 'STANDARD'
  | 'TOURIST_REFUND'            // Box 2 (deduction from Output VAT)
  | 'CUSTOMS_IMPORT'            // Box 6
  | 'CUSTOMS_IMPORT_ADJUSTMENT';// Box 7

export interface Vat201TransactionInput {
  transactionId: string;
  documentId: string;
  documentType: 'TAX_INVOICE' | 'TAX_CREDIT_NOTE' | 'TAX_DEBIT_NOTE' | 'COMMERCIAL_INVOICE' | 'EXPENSE_INVOICE';
  direction: TransactionDirection;
  nature?: Vat201TransactionNature; // Default 'STANDARD'
  issueDate: string;
  emirate: UaeEmirate;
  taxCategoryCode: 'S' | 'Z' | 'E' | 'O' | 'AE' | 'M';
  netAmountAed: Decimal | string | number;
  vatAmountAed: Decimal | string | number;
  inputTaxRecoveryPercent?: Decimal | string | number; // Default 100%
  rcmReference?: string;
}

export interface Vat201ReturnSummary {
  periodStart: string;
  periodEnd: string;
  taxpayerTrn: string;
  taxpayerName: string;

  // ==========================================
  // SECTION 1: VAT ON SALES AND OUTPUTS
  // ==========================================
  // Box 1: Standard Rated Supplies by Emirate
  box1a_AbuDhabi: EmirateSupplyBreakdown;
  box1b_Dubai: EmirateSupplyBreakdown;
  box1c_Sharjah: EmirateSupplyBreakdown;
  box1d_Ajman: EmirateSupplyBreakdown;
  box1e_UmmAlQuwain: EmirateSupplyBreakdown;
  box1f_RasAlKhaimah: EmirateSupplyBreakdown;
  box1g_Fujairah: EmirateSupplyBreakdown;
  
  box1_TotalStandardRatedTaxableAed: Decimal;
  box1_TotalStandardRatedVatAed: Decimal;
  box1_TotalStandardRatedAdjustmentsAed: Decimal;

  // Box 2: Tax Refunds Provided to Tourists Scheme
  box2_TouristRefundTaxableAed: Decimal;
  box2_TouristRefundVatAed: Decimal;

  // Box 3: Supplies Subject to Reverse Charge Provisions (INWARD RCM Purchases where Recipient accounts for Output VAT)
  box3_ReverseChargeTaxableAed: Decimal;
  box3_ReverseChargeVatAed: Decimal;

  // Box 4: Zero-Rated Supplies (Exports, International Transport, Healthcare, Education)
  box4_ZeroRatedTaxableAed: Decimal;

  // Box 5: Exempt Supplies (Financial Services, Residential Leases, Bare Land)
  box5_ExemptTaxableAed: Decimal;

  // Box 6: Goods Imported into the UAE (through UAE Customs)
  box6_ImportedGoodsTaxableAed: Decimal;
  box6_ImportedGoodsVatAed: Decimal;

  // Box 7: Adjustments to Goods Imported into the UAE
  box7_ImportedGoodsAdjustmentsVatAed: Decimal;

  // Box 8: Total Output Tax Due (Box 1 VAT + Box 1 Adjustments + Box 2 + Box 3 + Box 6 + Box 7)
  box8_TotalOutputTaxDueAed: Decimal;

  // Informational: Outward Domestic RCM Sales (Supplier perspective: displays 0% VAT, NOT added to Box 3 or Box 8)
  supplierOutwardRcmSalesAed: Decimal;

  // ==========================================
  // SECTION 2: VAT ON EXPENSES AND INPUTS
  // ==========================================
  // Box 9: Standard Rated Expenses
  box9_StandardRatedExpensesTaxableAed: Decimal;
  box9_StandardRatedExpensesRecoverableVatAed: Decimal;
  box9_StandardRatedExpensesAdjustmentsAed: Decimal;

  // Box 10: Supplies Subject to Reverse Charge Provisions (Recoverable Input VAT on Box 3 Inward Supplies)
  box10_ReverseChargeRecoverableVatAed: Decimal;

  // Box 11: Total Recoverable Tax (Box 9 Recoverable VAT + Adjustments + Box 10)
  box11_TotalRecoverableTaxAed: Decimal;

  // ==========================================
  // SECTION 3: NET VAT DUE / (REFUNDABLE)
  // ==========================================
  // Box 12: Total Value of Due Tax for the Period (= Box 8)
  box12_TotalDueTaxAed: Decimal;

  // Box 13: Total Value of Recoverable Tax for the Period (= Box 11)
  box13_TotalRecoverableTaxAed: Decimal;

  // Box 14: Payable Tax for the Period (Box 12 - Box 13, positive = payable, negative = refundable)
  box14_NetPayableTaxAed: Decimal;

  // Summary Totals
  totalTaxableSuppliesAed: Decimal;
  totalOutputTaxDueAed: Decimal; // Alias for box8
}

export class Vat201Aggregator {
  public static readonly EMIRATES: UaeEmirate[] = [
    'Abu Dhabi',
    'Dubai',
    'Sharjah',
    'Ajman',
    'Umm Al Quwain',
    'Ras Al Khaimah',
    'Fujairah'
  ];

  /**
   * Aggregates normalized transactions into an official FTA VAT 201 Return.
   * Strictly separates Sales Outputs, Inward Purchases, and Reverse Charge directions.
   */
  public static aggregateTransactions(
    transactions: Vat201TransactionInput[],
    metadata: {
      periodStart: string;
      periodEnd: string;
      trn: string;
      companyName: string;
    }
  ): Vat201ReturnSummary {
    const emirateMap = new Map<UaeEmirate, { taxable: Decimal; vat: Decimal; adjustments: Decimal }>();
    for (const em of this.EMIRATES) {
      emirateMap.set(em, {
        taxable: Decimal.zero(),
        vat: Decimal.zero(),
        adjustments: Decimal.zero()
      });
    }

    let box2TouristRefundTaxable = Decimal.zero();
    let box2TouristRefundVat = Decimal.zero();
    let box3ReverseChargeTaxable = Decimal.zero();
    let box3ReverseChargeVat = Decimal.zero();
    let box4ZeroRatedTaxable = Decimal.zero();
    let box5ExemptTaxable = Decimal.zero();
    let box6ImportTaxable = Decimal.zero();
    let box6ImportVat = Decimal.zero();
    let box7ImportAdjustmentVat = Decimal.zero();
    let supplierOutwardRcmSales = Decimal.zero();

    // Expenses (Inputs)
    let box9Taxable = Decimal.zero();
    let box9RecoverableVat = Decimal.zero();
    let box9Adjustments = Decimal.zero();
    let box10ReverseChargeRecoverableVat = Decimal.zero();

    for (const tx of transactions) {
      const isCreditNote = tx.documentType.includes('CREDIT_NOTE');
      const netAed = new Decimal(tx.netAmountAed).round(2, 'HALF_UP');
      const vatAed = new Decimal(tx.vatAmountAed).round(2, 'HALF_UP');
      const recoveryRate = tx.inputTaxRecoveryPercent !== undefined 
        ? new Decimal(tx.inputTaxRecoveryPercent).div(100)
        : new Decimal(1); // Default 100% recovery

      // 1. Check for specific statutory transaction natures first
      if (tx.nature === 'TOURIST_REFUND') {
        // FTA Guide: Box 2 Tourist refund scheme deduction reducing output tax
        box2TouristRefundTaxable = box2TouristRefundTaxable.add(netAed);
        box2TouristRefundVat = box2TouristRefundVat.add(vatAed);
        continue;
      }

      if (tx.nature === 'CUSTOMS_IMPORT') {
        // FTA Guide: Box 6 Customs declarations under taxpayer TRN
        box6ImportTaxable = box6ImportTaxable.add(netAed);
        box6ImportVat = box6ImportVat.add(vatAed);
        continue;
      }

      if (tx.nature === 'CUSTOMS_IMPORT_ADJUSTMENT') {
        // FTA Guide: Box 7 Customs import adjustments
        box7ImportAdjustmentVat = isCreditNote 
          ? box7ImportAdjustmentVat.sub(vatAed) 
          : box7ImportAdjustmentVat.add(vatAed);
        continue;
      }

      if (tx.direction === 'SALES_OUTPUT') {
        // Outward Sales Supplies
        switch (tx.taxCategoryCode) {
          case 'S': { // Standard Rated (5%)
            const emRecord = emirateMap.get(tx.emirate)!;
            if (isCreditNote) {
              // Credit note adjusts taxable sales and reduces VAT via Adjustments column
              emRecord.taxable = emRecord.taxable.sub(netAed);
              emRecord.adjustments = emRecord.adjustments.sub(vatAed);
            } else {
              emRecord.taxable = emRecord.taxable.add(netAed);
              emRecord.vat = emRecord.vat.add(vatAed);
            }
            break;
          }

          case 'AE': { // Domestic Reverse Charge - SUPPLIER PERSPECTIVE
            // Under CD 91/2023 Art. 2, the recipient accounts for tax.
            // The supplier charges 0% VAT. Must NOT be added to Box 3 Output Tax!
            if (isCreditNote) {
              supplierOutwardRcmSales = supplierOutwardRcmSales.sub(netAed);
            } else {
              supplierOutwardRcmSales = supplierOutwardRcmSales.add(netAed);
            }
            break;
          }

          case 'Z': { // Zero-Rated
            if (isCreditNote) {
              box4ZeroRatedTaxable = box4ZeroRatedTaxable.sub(netAed);
            } else {
              box4ZeroRatedTaxable = box4ZeroRatedTaxable.add(netAed);
            }
            break;
          }

          case 'E':   // Exempt
          case 'O':   // Out of Scope
          case 'M': { // Margin Scheme
            if (isCreditNote) {
              box5ExemptTaxable = box5ExemptTaxable.sub(netAed);
            } else {
              box5ExemptTaxable = box5ExemptTaxable.add(netAed);
            }
            break;
          }
        }
      } else if (tx.direction === 'PURCHASE_INPUT') {
        // Inward Purchases & Expenses
        switch (tx.taxCategoryCode) {
          case 'AE': { // Inward Reverse Charge - RECIPIENT PERSPECTIVE
            // Recipient accounts for Output VAT in Box 3 (Art. 48 & CD 91/2023)
            const rcmVatDue = netAed.mul(5).div(100).round(2, 'HALF_UP');
            const rcmVatRecoverable = rcmVatDue.mul(recoveryRate).round(2, 'HALF_UP');

            if (isCreditNote) {
              box3ReverseChargeTaxable = box3ReverseChargeTaxable.sub(netAed);
              box3ReverseChargeVat = box3ReverseChargeVat.sub(rcmVatDue);
              box10ReverseChargeRecoverableVat = box10ReverseChargeRecoverableVat.sub(rcmVatRecoverable);
            } else {
              box3ReverseChargeTaxable = box3ReverseChargeTaxable.add(netAed);
              box3ReverseChargeVat = box3ReverseChargeVat.add(rcmVatDue);
              box10ReverseChargeRecoverableVat = box10ReverseChargeRecoverableVat.add(rcmVatRecoverable);
            }
            break;
          }

          case 'S': { // Standard Rated Business Expenses
            const recoverablePortion = vatAed.mul(recoveryRate).round(2, 'HALF_UP');
            if (isCreditNote) {
              box9Taxable = box9Taxable.sub(netAed);
              box9Adjustments = box9Adjustments.sub(recoverablePortion);
            } else {
              box9Taxable = box9Taxable.add(netAed);
              box9RecoverableVat = box9RecoverableVat.add(recoverablePortion);
            }
            break;
          }

          default:
            // Non-recoverable or zero-rated inputs
            break;
        }
      }
    }

    // Build Box 1 Emirate Breakdown
    const buildEmirateBreakdown = (em: UaeEmirate): EmirateSupplyBreakdown => {
      const rec = emirateMap.get(em)!;
      return {
        emirate: em,
        taxableAmountAed: rec.taxable,
        vatAmountAed: rec.vat,
        adjustmentsAed: rec.adjustments
      };
    };

    const b1a = buildEmirateBreakdown('Abu Dhabi');
    const b1b = buildEmirateBreakdown('Dubai');
    const b1c = buildEmirateBreakdown('Sharjah');
    const b1d = buildEmirateBreakdown('Ajman');
    const b1e = buildEmirateBreakdown('Umm Al Quwain');
    const b1f = buildEmirateBreakdown('Ras Al Khaimah');
    const b1g = buildEmirateBreakdown('Fujairah');

    let totalBox1Taxable = Decimal.zero();
    let totalBox1Vat = Decimal.zero();
    let totalBox1Adjustments = Decimal.zero();

    for (const b of [b1a, b1b, b1c, b1d, b1e, b1f, b1g]) {
      totalBox1Taxable = totalBox1Taxable.add(b.taxableAmountAed);
      totalBox1Vat = totalBox1Vat.add(b.vatAmountAed);
      totalBox1Adjustments = totalBox1Adjustments.add(b.adjustmentsAed);
    }

    // Official FTA VAT 201 Guide (VATG001) Output Tax Calculation:
    // Box 8 Total Output Tax Due =
    //   (Box 1 VAT + Box 1 Adjustments)
    //   - Box 2 Tourist Refund VAT (Deduction reducing output tax)
    //   + Box 3 Reverse Charge VAT (Inward RCM output tax accounted for by recipient)
    //   + Box 6 Goods imported into UAE
    //   + Box 7 Adjustments to goods imported
    const netBox1Vat = totalBox1Vat.add(totalBox1Adjustments);
    const box8TotalOutputTaxDue = netBox1Vat
      .sub(box2TouristRefundVat)
      .add(box3ReverseChargeVat)
      .add(box6ImportVat)
      .add(box7ImportAdjustmentVat);

    // Input Tax Calculation: Box 9 Recoverable + Box 9 Adjustments + Box 10
    const netBox9Vat = box9RecoverableVat.add(box9Adjustments);
    const box11TotalRecoverableTax = netBox9Vat.add(box10ReverseChargeRecoverableVat);

    // Net Payable / (Refundable): Box 12 - Box 13 (Positive = Payable, Negative = Refundable)
    const box14NetPayableTax = box8TotalOutputTaxDue.sub(box11TotalRecoverableTax);

    const totalTaxableSupplies = totalBox1Taxable
      .add(box3ReverseChargeTaxable)
      .add(box4ZeroRatedTaxable)
      .add(box5ExemptTaxable)
      .add(box6ImportTaxable)
      .add(supplierOutwardRcmSales);

    return {
      periodStart: metadata.periodStart,
      periodEnd: metadata.periodEnd,
      taxpayerTrn: metadata.trn,
      taxpayerName: metadata.companyName,
      box1a_AbuDhabi: b1a,
      box1b_Dubai: b1b,
      box1c_Sharjah: b1c,
      box1d_Ajman: b1d,
      box1e_UmmAlQuwain: b1e,
      box1f_RasAlKhaimah: b1f,
      box1g_Fujairah: b1g,
      box1_TotalStandardRatedTaxableAed: totalBox1Taxable,
      box1_TotalStandardRatedVatAed: totalBox1Vat,
      box1_TotalStandardRatedAdjustmentsAed: totalBox1Adjustments,
      box2_TouristRefundTaxableAed: box2TouristRefundTaxable,
      box2_TouristRefundVatAed: box2TouristRefundVat,
      box3_ReverseChargeTaxableAed: box3ReverseChargeTaxable,
      box3_ReverseChargeVatAed: box3ReverseChargeVat,
      box4_ZeroRatedTaxableAed: box4ZeroRatedTaxable,
      box5_ExemptTaxableAed: box5ExemptTaxable,
      box6_ImportedGoodsTaxableAed: box6ImportTaxable,
      box6_ImportedGoodsVatAed: box6ImportVat,
      box7_ImportedGoodsAdjustmentsVatAed: box7ImportAdjustmentVat,
      box8_TotalOutputTaxDueAed: box8TotalOutputTaxDue,
      supplierOutwardRcmSalesAed: supplierOutwardRcmSales,
      box9_StandardRatedExpensesTaxableAed: box9Taxable,
      box9_StandardRatedExpensesRecoverableVatAed: box9RecoverableVat,
      box9_StandardRatedExpensesAdjustmentsAed: box9Adjustments,
      box10_ReverseChargeRecoverableVatAed: box10ReverseChargeRecoverableVat,
      box11_TotalRecoverableTaxAed: box11TotalRecoverableTax,
      box12_TotalDueTaxAed: box8TotalOutputTaxDue,
      box13_TotalRecoverableTaxAed: box11TotalRecoverableTax,
      box14_NetPayableTaxAed: box14NetPayableTax,
      totalOutputTaxDueAed: box8TotalOutputTaxDue,
      totalTaxableSuppliesAed: totalTaxableSupplies
    };
  }

  /**
   * Helper method to aggregate canonical invoices directly, specifying whether the reporting
   * entity is acting as the SELLER (outward sales) or BUYER (inward expenses).
   */
  public static aggregateInvoices(
    invoices: UaeCanonicalInvoice[],
    metadata: {
      periodStart: string;
      periodEnd: string;
      trn: string;
      companyName: string;
      taxpayerRole?: 'SELLER' | 'BUYER';
    }
  ): Vat201ReturnSummary {
    const role = metadata.taxpayerRole || 'SELLER';
    const txInputs: Vat201TransactionInput[] = [];

    for (const inv of invoices) {
      const isCreditNote = inv.invoiceType.includes('CREDIT_NOTE');
      let emirate: UaeEmirate = 'Dubai';
      const candEmirate = inv.seller?.address?.countrySubdivision || inv.buyer?.address?.countrySubdivision;
      if (candEmirate && this.EMIRATES.includes(candEmirate as UaeEmirate)) {
        emirate = candEmirate as UaeEmirate;
      }

      for (const line of inv.lines) {
        txInputs.push({
          transactionId: `${inv.documentId}-${line.lineId}`,
          documentId: inv.documentId,
          documentType: isCreditNote ? 'TAX_CREDIT_NOTE' : 'TAX_INVOICE',
          direction: role === 'SELLER' ? 'SALES_OUTPUT' : 'PURCHASE_INPUT',
          issueDate: inv.issueDate,
          emirate,
          taxCategoryCode: line.taxCategoryCode,
          netAmountAed: line.lineNetAmount.mul(inv.exchangeRateToAed || new Decimal(1)).round(2, 'HALF_UP'),
          vatAmountAed: line.vatLineAmountAed,
          inputTaxRecoveryPercent: 100,
          rcmReference: line.rcmReference
        });
      }
    }

    return this.aggregateTransactions(txInputs, metadata);
  }
}
