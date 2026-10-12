/**
 * UAE VAT Engine Version 2026.1 / 2027.1
 * Implements VAT rules under Federal Decree-Law No. 8 of 2017 (as amended),
 * Cabinet Decision No. 52 of 2017 (Executive Regulations),
 * Ministerial Decisions No. 243 & 244 of 2025, No. 66 & 168 of 2026,
 * and Cabinet Decisions No. 91/2023, 127/2024, 153/2025 on Domestic Reverse Charge.
 */

import { randomUUID } from 'node:crypto';
import { Decimal } from '../utils/decimal.js';
import {
  UaeCanonicalInvoice,
  UaeInvoiceLine,
  UaeTaxBreakdownItem,
  UaeTaxCategory,
  encodeTransactionBitmask,
  parseTransactionBitmask,
  FALLBACK_ENDPOINT_DEEMED,
  FALLBACK_ENDPOINT_EXPORT,
} from '../models/canonicalInvoice.js';
import {
  InvoiceCalculationInputSchema,
  RawInvoiceCalculationInput,
} from '../models/validationSchemas.js';
import {
  IUaeTaxRuleEngine,
  ValidationResult,
} from './taxRuleEngine.interface.js';

export class UaeVatEngine2026 implements IUaeTaxRuleEngine {
  public readonly version = '2026.1';
  public readonly effectiveFromDate = '2026-07-01';

  private static readonly STANDARD_VAT_RATE = new Decimal('5.00');
  private static readonly ZERO_VAT_RATE = new Decimal('0.00');

  constructor(private readonly clock: () => Date = () => new Date()) {}

  public calculate(
    input: RawInvoiceCalculationInput,
    options?: { evaluationDate?: Date | string }
  ): UaeCanonicalInvoice {
    // Determine runtime evaluation timestamp from options or injected clock
    const evaluationTimestamp = options?.evaluationDate
      ? new Date(options.evaluationDate)
      : this.clock();

    if (isNaN(evaluationTimestamp.getTime())) {
      throw new Error(`Invalid evaluation date: "${options?.evaluationDate}"`);
    }

    // 1. Validate raw input syntax with Zod
    const validatedInput = InvoiceCalculationInputSchema.parse(input);

    const isTaxInvoice = validatedInput.invoiceType === 'TAX_INVOICE' ||
      validatedInput.invoiceType === 'TAX_CREDIT_NOTE' ||
      validatedInput.invoiceType === 'SELF_BILLED_TAX_INVOICE';

    const invoiceTypeCode = validatedInput.invoiceType === 'TAX_CREDIT_NOTE' ||
      validatedInput.invoiceType === 'COMMERCIAL_CREDIT_NOTE' ||
      validatedInput.invoiceType === 'SELF_BILLED_CREDIT_NOTE'
      ? '381'
      : isTaxInvoice ? '388' : '380';

    // 2. Parse bitmask and apply statutory defaults
    const bitmask = parseTransactionBitmask(validatedInput.transactionBitmask);

    // 3. Multi-currency and Central Bank FX Exchange Rate setup (Article 69)
    const isAed = validatedInput.documentCurrencyCode.toUpperCase() === 'AED';
    let exchangeRate = new Decimal(1);
    if (!isAed) {
      if (!validatedInput.exchangeRateToAed || validatedInput.exchangeRateToAed <= 0) {
        throw new Error(
          `Exchange rate to AED approved by UAE Central Bank is mandatory when invoice currency is ${validatedInput.documentCurrencyCode}`
        );
      }

      if (!validatedInput.exchangeRateSourceDate) {
        throw new Error(
          `Central Bank exchange rate source date is mandatory when invoice currency is ${validatedInput.documentCurrencyCode}`
        );
      }

      const rateDate = new Date(validatedInput.exchangeRateSourceDate);
      if (isNaN(rateDate.getTime())) {
        throw new Error(
          `Invalid exchange rate source date format: "${validatedInput.exchangeRateSourceDate}". Must be a valid ISO date.`
        );
      }

      const supplyOrIssueDateStr = validatedInput.supplyDate || validatedInput.issueDate;
      const targetSupplyDate = new Date(supplyOrIssueDateStr);

      // Article 69: Rate must be the approved Central Bank rate at the date of supply
      // Rate cannot be in the future relative to the supply/issue date
      if (rateDate.getTime() > targetSupplyDate.getTime() + 86400000) {
        throw new Error(
          `Exchange rate source date (${validatedInput.exchangeRateSourceDate}) cannot be in the future relative to invoice supply date (${supplyOrIssueDateStr}) under UAE VAT Law Article 69.`
        );
      }

      // Rate source date cannot be in the future relative to the evaluation date
      const evalLimit = new Date(evaluationTimestamp.getTime());
      evalLimit.setHours(23, 59, 59, 999);
      if (rateDate.getTime() > evalLimit.getTime()) {
        throw new Error(
          `Exchange rate source date (${validatedInput.exchangeRateSourceDate}) cannot be in the future relative to evaluation date (${evaluationTimestamp.toISOString()}).`
        );
      }

      exchangeRate = new Decimal(validatedInput.exchangeRateToAed);
    }

    // 4. Fallback Endpoint adjustments
    const buyerParty = { ...validatedInput.buyer };
    if (bitmask.isDeemedSupply) {
      buyerParty.participantId = FALLBACK_ENDPOINT_DEEMED;
    } else if (bitmask.isExport && (!buyerParty.participantId || buyerParty.participantId === '0235:0000000000')) {
      buyerParty.participantId = FALLBACK_ENDPOINT_EXPORT;
    }

    // 5. Line Items Calculation with Decimal Precision
    const calculatedLines: UaeInvoiceLine[] = [];
    const categoryTotalsMap = new Map<UaeTaxCategory, {
      taxableAmount: Decimal;
      taxAmount: Decimal;
      rate: Decimal;
      exemptionReason?: string;
    }>();

    for (const lineInput of validatedInput.lines) {
      const quantity = new Decimal(lineInput.quantity);
      const unitPrice = new Decimal(lineInput.unitPrice);
      const discount = lineInput.discountAmount ? new Decimal(lineInput.discountAmount) : Decimal.zero();
      
      const itemNetPrice = unitPrice.sub(discount).round(4);
      const lineNetAmount = quantity.mul(itemNetPrice).round(2);

      // Determine Statutory Tax Rate by Category
      let lineTaxRate: Decimal;
      let lineTaxAmount: Decimal;

      switch (lineInput.taxCategoryCode) {
        case 'S': // Standard 5% Rate
          lineTaxRate = UaeVatEngine2026.STANDARD_VAT_RATE;
          // Statutory Article 61 Half-Up Rounding to nearest fils
          lineTaxAmount = lineNetAmount.mul(lineTaxRate).div(100).round(2, 'HALF_UP');
          break;

        case 'M': // Profit Margin Scheme (Art. 43 VAT Law)
          // Displayed tax on invoice must be 0 per official guidelines
          lineTaxRate = UaeVatEngine2026.ZERO_VAT_RATE;
          lineTaxAmount = Decimal.zero();
          bitmask.isMarginScheme = true;
          break;

        case 'AE': // Domestic Reverse Charge (Scrap, Metals, Electronics)
          // Displayed tax on invoice is 0; buyer accounts for tax
          lineTaxRate = UaeVatEngine2026.ZERO_VAT_RATE;
          lineTaxAmount = Decimal.zero();
          break;

        case 'Z': // Zero-rated (exports, international transport, health)
          lineTaxRate = UaeVatEngine2026.ZERO_VAT_RATE;
          lineTaxAmount = Decimal.zero();
          break;

        case 'E': // Exempt (financial services, residential rent)
        case 'O': // Out of scope
          lineTaxRate = UaeVatEngine2026.ZERO_VAT_RATE;
          lineTaxAmount = Decimal.zero();
          break;

        default:
          throw new Error(`Unsupported tax category code: ${lineInput.taxCategoryCode}`);
      }

      // Mandatory Dual-Currency AED Line Amounts (Article 61 HALF_UP)
      const vatLineAmountAed = lineTaxAmount.mul(exchangeRate).round(2, 'HALF_UP');
      const lineAmountAed = lineNetAmount.add(lineTaxAmount).mul(exchangeRate).round(2, 'HALF_UP');

      calculatedLines.push({
        lineId: lineInput.lineId,
        itemType: lineInput.itemType,
        itemName: lineInput.itemName,
        itemDescription: lineInput.itemDescription,
        invoicedQuantity: quantity,
        unitOfMeasureCode: lineInput.unitOfMeasureCode,
        itemGrossPrice: unitPrice,
        itemDiscountAmount: discount.isPositive() ? discount : undefined,
        itemNetPrice,
        priceBaseQuantity: new Decimal(1),
        lineNetAmount,
        taxCategoryCode: lineInput.taxCategoryCode,
        taxRatePercentage: lineTaxRate,
        taxAmount: lineTaxAmount,
        vatLineAmountAed,
        lineAmountAed,
        rcmReference: lineInput.rcmReference,
      });

      // Accumulate into Tax Category Map for Document Subtotals
      const existing = categoryTotalsMap.get(lineInput.taxCategoryCode) || {
        taxableAmount: Decimal.zero(),
        taxAmount: Decimal.zero(),
        rate: lineTaxRate,
        exemptionReason: lineInput.exemptionReasonText,
      };

      existing.taxableAmount = existing.taxableAmount.add(lineNetAmount);
      categoryTotalsMap.set(lineInput.taxCategoryCode, existing);
    }

    // 6. Article 61 Rounding: Category Tax Amounts calculated from Category Taxable Base
    const taxBreakdown: UaeTaxBreakdownItem[] = [];
    let totalTaxAmount = Decimal.zero();

    for (const [catCode, data] of categoryTotalsMap.entries()) {
      // Calculate tax on category taxable amount rounded to nearest fils (Article 61 HALF_UP)
      let categoryTax: Decimal;
      if (catCode === 'S') {
        categoryTax = data.taxableAmount.mul(data.rate).div(100).round(2, 'HALF_UP');
      } else {
        categoryTax = Decimal.zero();
      }

      const taxableAed = data.taxableAmount.mul(exchangeRate).round(2, 'HALF_UP');
      const taxAed = categoryTax.mul(exchangeRate).round(2, 'HALF_UP');

      taxBreakdown.push({
        taxCategoryCode: catCode,
        taxRatePercentage: data.rate,
        taxableAmount: data.taxableAmount,
        taxAmount: categoryTax,
        taxableAmountAed: taxableAed,
        taxAmountAed: taxAed,
        exemptionReasonText: data.exemptionReason,
      });

      totalTaxAmount = totalTaxAmount.add(categoryTax);
    }

    // 7. Monetary Totals Calculations
    let lineExtensionAmount = Decimal.zero();
    for (const l of calculatedLines) {
      lineExtensionAmount = lineExtensionAmount.add(l.lineNetAmount);
    }

    const documentAllowances = validatedInput.documentAllowances
      ? new Decimal(validatedInput.documentAllowances).round(2, 'HALF_UP')
      : Decimal.zero();

    const documentCharges = validatedInput.documentCharges
      ? new Decimal(validatedInput.documentCharges).round(2, 'HALF_UP')
      : Decimal.zero();

    const taxExclusiveAmount = lineExtensionAmount.sub(documentAllowances).add(documentCharges);
    const taxInclusiveAmount = taxExclusiveAmount.add(totalTaxAmount);

    const prepaidAmount = validatedInput.prepaidAmount
      ? new Decimal(validatedInput.prepaidAmount).round(2, 'HALF_UP')
      : Decimal.zero();

    const roundingAmount = validatedInput.roundingAmount
      ? new Decimal(validatedInput.roundingAmount).round(2, 'HALF_UP')
      : Decimal.zero();

    const payableAmount = taxInclusiveAmount.sub(prepaidAmount).add(roundingAmount);

    const totalVatAmountAed = totalTaxAmount.mul(exchangeRate).round(2, 'HALF_UP');
    const totalPayableAmountAed = payableAmount.mul(exchangeRate).round(2, 'HALF_UP');

    const updatedBitmaskCode = encodeTransactionBitmask(bitmask);

    const canonicalInvoice: UaeCanonicalInvoice = {
      schemaVersion: '1.0',
      taxRuleVersion: this.version,
      documentId: validatedInput.documentId,
      uuid: randomUUID(),
      issueDate: validatedInput.issueDate,
      issueTime: validatedInput.issueTime,
      supplyDate: validatedInput.supplyDate,
      dueDate: validatedInput.dueDate,
      invoiceType: validatedInput.invoiceType,
      invoiceTypeCode,
      isTaxInvoice,
      transactionBitmask: bitmask,
      transactionTypeCode: updatedBitmaskCode,
      documentCurrencyCode: validatedInput.documentCurrencyCode,
      taxAccountingCurrencyCode: 'AED',
      exchangeRateToAed: !isAed ? exchangeRate : undefined,
      exchangeRateSourceDate: validatedInput.exchangeRateSourceDate,
      seller: validatedInput.seller,
      buyer: buyerParty,
      beneficiary: validatedInput.beneficiary,
      precedingInvoiceReferences: validatedInput.precedingInvoiceReferences,
      lines: calculatedLines,
      taxBreakdown,
      lineExtensionAmount,
      taxExclusiveAmount,
      taxInclusiveAmount,
      totalTaxAmount,
      allowanceTotalAmount: documentAllowances,
      chargeTotalAmount: documentCharges,
      prepaidAmount,
      roundingAmount,
      payableAmount,
      totalVatAmountAed,
      totalPayableAmountAed,
      paymentMeansCode: validatedInput.paymentMeansCode,
      paymentTerms: validatedInput.paymentTerms,
      calculationAuditTrail: {
        statutoryRule: 'ARTICLE_61_HALF_UP',
        internalScalePrecision: 8,
        calculationTimestamp: evaluationTimestamp.toISOString(),
        fxSource: !isAed ? 'CBUAE' : undefined,
        fxSourceDate: validatedInput.exchangeRateSourceDate,
        fxRateApplied: !isAed ? exchangeRate : undefined,
      },
    };

    return canonicalInvoice;
  }

  public validate(invoice: UaeCanonicalInvoice): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Check Credit Note Preceding References
    if (invoice.invoiceTypeCode === '381') {
      if (!invoice.precedingInvoiceReferences || invoice.precedingInvoiceReferences.length === 0) {
        errors.push('Credit note must contain at least one preceding invoice reference (BT-25)');
      }
    }

    // 2. Check Free Zone Beneficiary
    if (invoice.transactionBitmask.isFreeTradeZone && !invoice.beneficiary) {
      errors.push('Free Zone transactions require mandatory Beneficiary details');
    }

    // 3. Check Reverse Charge Narrative
    for (const b of invoice.taxBreakdown) {
      if (b.taxCategoryCode === 'AE' && (!b.exemptionReasonText || b.exemptionReasonText.trim().length === 0)) {
        errors.push('Domestic Reverse Charge (AE) requires mandatory statutory exemption narrative citing applicable Cabinet Decision');
      }
      if (b.taxCategoryCode === 'E' && (!b.exemptionReasonText || b.exemptionReasonText.trim().length === 0)) {
        errors.push('Exempt supply (E) requires mandatory statutory exemption narrative citing Article 42 of VAT Executive Regulations');
      }
    }

    // 4. Multi-Currency Validation
    if (invoice.documentCurrencyCode !== 'AED') {
      if (!invoice.exchangeRateToAed || invoice.exchangeRateToAed.isZero()) {
        errors.push('Central Bank exchange rate to AED is mandatory for foreign currency invoices');
      }
      if (invoice.isTaxInvoice && invoice.totalVatAmountAed === undefined) {
        errors.push('Total VAT amount in AED is mandatory for foreign currency tax invoices');
      }
    }

    // 5. 14-Day Statutory Issuance Window check (MD 243/2025 Art. 6(5))
    if (invoice.supplyDate && invoice.issueDate) {
      const supplyTime = new Date(invoice.supplyDate).getTime();
      const issueTime = new Date(invoice.issueDate).getTime();
      const daysDiff = (issueTime - supplyTime) / (1000 * 60 * 60 * 24);
      if (daysDiff > 14) {
        warnings.push(`Invoice issue date is ${Math.round(daysDiff)} days after supply date, exceeding the standard 14-day statutory timeline (MD 243/2025 Art. 6(5))`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
