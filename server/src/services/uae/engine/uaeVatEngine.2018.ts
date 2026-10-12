/**
 * Legacy UAE VAT Engine Version 2018.1
 * Covers supplies prior to 1 July 2026 under initial VAT legislation
 * without Peppol PINT AE mandatory eInvoicing fields.
 */

import { randomUUID } from 'node:crypto';
import { Decimal } from '../utils/decimal.js';
import {
  UaeCanonicalInvoice,
  UaeInvoiceLine,
  UaeTaxBreakdownItem,
  UaeTaxCategory,
  parseTransactionBitmask,
} from '../models/canonicalInvoice.js';
import {
  InvoiceCalculationInputSchema,
  RawInvoiceCalculationInput,
} from '../models/validationSchemas.js';
import {
  IUaeTaxRuleEngine,
  ValidationResult,
} from './taxRuleEngine.interface.js';

export class UaeVatEngine2018 implements IUaeTaxRuleEngine {
  public readonly version = '2018.1';
  public readonly effectiveFromDate = '2018-01-01';
  public readonly effectiveToDate = '2026-06-30';

  private static readonly STANDARD_VAT_RATE = new Decimal('5.00');
  private static readonly ZERO_VAT_RATE = new Decimal('0.00');

  public calculate(input: RawInvoiceCalculationInput): UaeCanonicalInvoice {
    const validatedInput = InvoiceCalculationInputSchema.parse(input);
    const bitmask = parseTransactionBitmask(validatedInput.transactionBitmask || '00000000');

    const isAed = validatedInput.documentCurrencyCode.toUpperCase() === 'AED';
    const exchangeRate = isAed ? new Decimal(1) : new Decimal(validatedInput.exchangeRateToAed || 1);

    const calculatedLines: UaeInvoiceLine[] = [];
    const categoryTotalsMap = new Map<UaeTaxCategory, {
      taxableAmount: Decimal;
      taxAmount: Decimal;
      rate: Decimal;
    }>();

    for (const lineInput of validatedInput.lines) {
      const quantity = new Decimal(lineInput.quantity);
      const unitPrice = new Decimal(lineInput.unitPrice);
      const discount = lineInput.discountAmount ? new Decimal(lineInput.discountAmount) : Decimal.zero();
      const itemNetPrice = unitPrice.sub(discount).round(4);
      const lineNetAmount = quantity.mul(itemNetPrice).round(2);

      const rate = lineInput.taxCategoryCode === 'S'
        ? UaeVatEngine2018.STANDARD_VAT_RATE
        : UaeVatEngine2018.ZERO_VAT_RATE;

      const lineTax = lineInput.taxCategoryCode === 'S'
        ? lineNetAmount.mul(rate).div(100).round(2)
        : Decimal.zero();

      calculatedLines.push({
        lineId: lineInput.lineId,
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
        taxRatePercentage: rate,
        taxAmount: lineTax,
        vatLineAmountAed: lineTax.mul(exchangeRate).round(2),
        lineAmountAed: lineNetAmount.add(lineTax).mul(exchangeRate).round(2),
      });

      const existing = categoryTotalsMap.get(lineInput.taxCategoryCode) || {
        taxableAmount: Decimal.zero(),
        taxAmount: Decimal.zero(),
        rate,
      };
      existing.taxableAmount = existing.taxableAmount.add(lineNetAmount);
      categoryTotalsMap.set(lineInput.taxCategoryCode, existing);
    }

    const taxBreakdown: UaeTaxBreakdownItem[] = [];
    let totalTaxAmount = Decimal.zero();

    for (const [catCode, data] of categoryTotalsMap.entries()) {
      const categoryTax = catCode === 'S'
        ? data.taxableAmount.mul(data.rate).div(100).round(2)
        : Decimal.zero();

      taxBreakdown.push({
        taxCategoryCode: catCode,
        taxRatePercentage: data.rate,
        taxableAmount: data.taxableAmount,
        taxAmount: categoryTax,
        taxableAmountAed: data.taxableAmount.mul(exchangeRate).round(2),
        taxAmountAed: categoryTax.mul(exchangeRate).round(2),
      });
      totalTaxAmount = totalTaxAmount.add(categoryTax);
    }

    let lineExtensionAmount = Decimal.zero();
    for (const l of calculatedLines) {
      lineExtensionAmount = lineExtensionAmount.add(l.lineNetAmount);
    }

    const documentAllowances = validatedInput.documentAllowances
      ? new Decimal(validatedInput.documentAllowances).round(2)
      : Decimal.zero();
    const documentCharges = validatedInput.documentCharges
      ? new Decimal(validatedInput.documentCharges).round(2)
      : Decimal.zero();

    const taxExclusiveAmount = lineExtensionAmount.sub(documentAllowances).add(documentCharges);
    const taxInclusiveAmount = taxExclusiveAmount.add(totalTaxAmount);
    const payableAmount = taxInclusiveAmount;

    return {
      schemaVersion: '1.0',
      taxRuleVersion: this.version,
      documentId: validatedInput.documentId,
      uuid: randomUUID(),
      issueDate: validatedInput.issueDate,
      issueTime: validatedInput.issueTime,
      supplyDate: validatedInput.supplyDate,
      dueDate: validatedInput.dueDate,
      invoiceType: validatedInput.invoiceType,
      invoiceTypeCode: validatedInput.invoiceType.includes('CREDIT') ? '381' : '388',
      isTaxInvoice: true,
      transactionBitmask: bitmask,
      transactionTypeCode: validatedInput.transactionBitmask || '00000000',
      documentCurrencyCode: validatedInput.documentCurrencyCode,
      taxAccountingCurrencyCode: 'AED',
      exchangeRateToAed: !isAed ? exchangeRate : undefined,
      seller: validatedInput.seller,
      buyer: validatedInput.buyer,
      lines: calculatedLines,
      taxBreakdown,
      lineExtensionAmount,
      taxExclusiveAmount,
      taxInclusiveAmount,
      allowanceTotalAmount: documentAllowances,
      chargeTotalAmount: documentCharges,
      prepaidAmount: Decimal.zero(),
      roundingAmount: Decimal.zero(),
      payableAmount,
      totalVatAmountAed: totalTaxAmount.mul(exchangeRate).round(2),
      totalPayableAmountAed: payableAmount.mul(exchangeRate).round(2),
      paymentMeansCode: validatedInput.paymentMeansCode,
    };
  }

  public validate(invoice: UaeCanonicalInvoice): ValidationResult {
    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  }
}
