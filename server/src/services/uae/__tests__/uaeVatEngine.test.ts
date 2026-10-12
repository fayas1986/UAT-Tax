import { describe, it, expect } from 'vitest';
import { UaeVatEngine2026 } from '../engine/uaeVatEngine.2026.js';
import { UaeVatEngineFactory } from '../engine/vatEngineFactory.js';
import {
  FALLBACK_ENDPOINT_DEEMED,
  FALLBACK_ENDPOINT_UNREGISTERED,
  FALLBACK_ENDPOINT_EXPORT,
} from '../models/canonicalInvoice.js';

describe('UAE VAT Engine 2026 - Deterministic Compliance Fixtures', () => {
  const engine = new UaeVatEngine2026();

  const standardSeller = {
    name: 'Alwadi National Trading LLC',
    tin: '1001234567',
    trn: '100123456700003',
    participantId: '0235:1001234567',
    legalRegistration: { id: 'TL-889922', type: 'TL' as const, issuingAuthority: 'DET Dubai' },
    address: {
      addressLine1: 'Business Bay, Tower 1',
      city: 'Dubai',
      countrySubdivision: 'Dubai',
      countryCode: 'AE',
    },
  };

  const standardBuyer = {
    name: 'Gulf Solutions FZCO',
    tin: '1007654321',
    trn: '100765432100003',
    participantId: '0235:1007654321',
    legalRegistration: { id: 'FZ-554411', type: 'TL' as const, issuingAuthority: 'DDA' },
    address: {
      addressLine1: 'Dubai Internet City, Bldg 3',
      city: 'Dubai',
      countrySubdivision: 'Dubai',
      countryCode: 'AE',
    },
  };

  it('FX-01: Standard B2B Supply in AED (5% Standard Rate)', () => {
    const input = {
      documentId: 'INV-2026-0001',
      issueDate: '2026-07-15',
      dueDate: '2026-08-15',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'Commercial IT Advisory Services',
          quantity: 1,
          unitOfMeasureCode: 'HUR',
          unitPrice: 10000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.lineExtensionAmount.toFixed(2)).toBe('10000.00');
    expect(result.taxExclusiveAmount.toFixed(2)).toBe('10000.00');
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('500.00');
    expect(result.lines[0].vatLineAmountAed.toFixed(2)).toBe('500.00');
    expect(result.lines[0].lineAmountAed.toFixed(2)).toBe('10500.00');
    expect(result.taxInclusiveAmount.toFixed(2)).toBe('10500.00');
    expect(result.payableAmount.toFixed(2)).toBe('10500.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('500.00');
    expect(result.totalPayableAmountAed.toFixed(2)).toBe('10500.00');
    expect(result.transactionTypeCode).toBe('00000000');

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('FX-02: Zero-Rated Export of Services in USD with CBUAE Conversion', () => {
    const foreignBuyer = {
      name: 'Acme International SAS',
      tin: '0000000000',
      participantId: '0235:0000000000',
      legalRegistration: { id: 'FR-998877', type: 'PAS' as const },
      address: {
        addressLine1: '12 Rue de la Paix',
        city: 'Paris',
        countrySubdivision: 'Ile-de-France',
        countryCode: 'FR',
      },
    };

    const input = {
      documentId: 'INV-2026-0002',
      issueDate: '2026-07-20',
      dueDate: '2026-08-20',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'USD',
      exchangeRateToAed: 3.6725, // Official CBUAE rate
      exchangeRateSourceDate: '2026-07-20',
      seller: standardSeller,
      buyer: foreignBuyer,
      transactionBitmask: '00000001', // Bit 8 = Export
      lines: [
        {
          lineId: '1',
          itemName: 'Cross-Border Engineering Consulting',
          quantity: 1,
          unitOfMeasureCode: 'HUR',
          unitPrice: 10000.00,
          taxCategoryCode: 'Z' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.documentCurrencyCode).toBe('USD');
    expect(result.lineExtensionAmount.toFixed(2)).toBe('10000.00');
    expect(result.taxInclusiveAmount.toFixed(2)).toBe('10000.00');
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('0.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('0.00');
    // 10,000 * 3.6725 = 36,725.00 AED
    expect(result.totalPayableAmountAed.toFixed(2)).toBe('36725.00');
    // Buyer endpoint must automatically fall back to 0235:9900000099
    expect(result.buyer.participantId).toBe(FALLBACK_ENDPOINT_EXPORT);

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-03: Exempt Financial Service with Mandatory Statutory Narrative', () => {
    const input = {
      documentId: 'INV-2026-0003',
      issueDate: '2026-07-25',
      dueDate: '2026-08-25',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'Commercial Credit Facility Underwriting Fee',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 5000.00,
          taxCategoryCode: 'E' as const,
          exemptionReasonText: 'Exempt under Article 42 of UAE VAT Executive Regulations',
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('0.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('0.00');
    expect(result.payableAmount.toFixed(2)).toBe('5000.00');
    expect(result.taxBreakdown[0].taxCategoryCode).toBe('E');
    expect(result.taxBreakdown[0].exemptionReasonText).toContain('Article 42');

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-04: Domestic Reverse Charge (Scrap Metal CD 153/2025)', () => {
    const input = {
      documentId: 'INV-2026-0004',
      issueDate: '2026-08-01',
      dueDate: '2026-08-31',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'Industrial Scrap Metal Bulk',
          quantity: 50,
          unitOfMeasureCode: 'TNE',
          unitPrice: 1000.00,
          taxCategoryCode: 'AE' as const,
          rcmReference: 'METAL_SCRAP' as const,
          exemptionReasonText: 'Supply subject to Domestic Reverse Charge under Cabinet Decision No. 153 of 2025',
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    // Displayed tax on invoice must be 0.00
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('0.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('0.00');
    expect(result.payableAmount.toFixed(2)).toBe('50000.00');
    expect(result.taxBreakdown[0].taxCategoryCode).toBe('AE');

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-05: Profit Margin Scheme (Art. 43 VAT Law)', () => {
    const input = {
      documentId: 'INV-2026-0005',
      issueDate: '2026-08-05',
      dueDate: '2026-08-05',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      transactionBitmask: '00100000', // Bit 3 = Margin Scheme
      lines: [
        {
          lineId: '1',
          itemName: 'Pre-Owned Commercial Transport Vehicle',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 40000.00,
          taxCategoryCode: 'M' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    // VAT amount displayed to customer must be 0 per official guidelines
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('0.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('0.00');
    expect(result.payableAmount.toFixed(2)).toBe('40000.00');
    expect(result.transactionBitmask.isMarginScheme).toBe(true);
    expect(result.transactionTypeCode[2]).toBe('1'); // Bit 3 is 1

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-06: Free Zone Supply with Beneficiary Details', () => {
    const input = {
      documentId: 'INV-2026-0006',
      issueDate: '2026-08-10',
      dueDate: '2026-09-10',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      transactionBitmask: '10000000', // Bit 1 = Free Trade Zone
      beneficiary: {
        beneficiaryName: 'JAFZA Logistics End User FZCO',
        beneficiaryId: 'FZ-998811',
      },
      lines: [
        {
          lineId: '1',
          itemName: 'Free Zone Warehouse Equipment',
          quantity: 2,
          unitOfMeasureCode: 'EA',
          unitPrice: 5000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.transactionBitmask.isFreeTradeZone).toBe(true);
    expect(result.beneficiary?.beneficiaryName).toBe('JAFZA Logistics End User FZCO');

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-07: Deemed Supply Forces Fallback Endpoint 0235:9900000097', () => {
    const input = {
      documentId: 'INV-2026-0007',
      issueDate: '2026-08-12',
      dueDate: '2026-08-12',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      transactionBitmask: '01000000', // Bit 2 = Deemed Supply
      lines: [
        {
          lineId: '1',
          itemName: 'Business Asset Disposition (No Consideration)',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 20000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.buyer.participantId).toBe(FALLBACK_ENDPOINT_DEEMED);
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('1000.00'); // 5% of 20,000
    expect(result.totalVatAmountAed.toFixed(2)).toBe('1000.00');
  });

  it('FX-08: Supply to Unregistered Buyer with Fallback Endpoint 0235:9900000098', () => {
    const unregisteredBuyer = {
      ...standardBuyer,
      participantId: FALLBACK_ENDPOINT_UNREGISTERED,
    };

    const input = {
      documentId: 'INV-2026-0008',
      issueDate: '2026-08-15',
      dueDate: '2026-09-15',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: unregisteredBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'Hardware Server Maintenance',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 8000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.buyer.participantId).toBe(FALLBACK_ENDPOINT_UNREGISTERED);
    expect(result.isTaxInvoice).toBe(true);
  });

  it('FX-09: Multi-Currency EUR Invoice with Dual Currency AED Breakdown', () => {
    const input = {
      documentId: 'INV-2026-0009',
      issueDate: '2026-08-18',
      dueDate: '2026-09-18',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'EUR',
      exchangeRateToAed: 4.0200, // CBUAE approved rate
      exchangeRateSourceDate: '2026-08-18',
      seller: standardSeller,
      buyer: standardBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'European Cloud Infrastructure Subscription',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 5000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.lineExtensionAmount.toFixed(2)).toBe('5000.00');
    expect(result.lines[0].taxAmount.toFixed(2)).toBe('250.00'); // 5% of 5,000 EUR
    // Line VAT in AED: 250 * 4.02 = 1,005.00 AED
    expect(result.lines[0].vatLineAmountAed.toFixed(2)).toBe('1005.00');
    // Line Amount in AED: (5000 + 250) * 4.02 = 21,105.00 AED
    expect(result.lines[0].lineAmountAed.toFixed(2)).toBe('21105.00');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('1005.00');
    expect(result.totalPayableAmountAed.toFixed(2)).toBe('21105.00');
  });

  it('FX-10: Electronic Tax Credit Note Validation', () => {
    const input = {
      documentId: 'CRN-2026-0001',
      issueDate: '2026-08-20',
      dueDate: '2026-08-20',
      invoiceType: 'TAX_CREDIT_NOTE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      precedingInvoiceReferences: [
        {
          invoiceNumber: 'INV-2026-0001',
          issueDate: '2026-07-15',
          creditReasonCode: 'DISCOUNT',
          creditReasonDescription: '20% retroactive volume discount',
        },
      ],
      lines: [
        {
          lineId: '1',
          itemName: 'Credit adjustment on advisory services',
          quantity: 1,
          unitOfMeasureCode: 'HUR',
          unitPrice: 2000.00,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.invoiceTypeCode).toBe('381');
    expect(result.precedingInvoiceReferences).toHaveLength(1);
    expect(result.precedingInvoiceReferences?.[0].invoiceNumber).toBe('INV-2026-0001');

    const validation = engine.validate(result);
    expect(validation.valid).toBe(true);
  });

  it('FX-11: Article 61 Rounding Test & Subtotal Reconciliation', () => {
    // 3 fractional lines:
    // Line 1: 10.33 * 0.05 = 0.5165 -> line rounded: 0.52
    // Line 2: 20.67 * 0.05 = 1.0335 -> line rounded: 1.03
    // Line 3: 15.45 * 0.05 = 0.7725 -> line rounded: 0.77
    // Total taxable: 10.33 + 20.67 + 15.45 = 46.45
    // Category tax: 46.45 * 0.05 = 2.3225 -> 2.32
    const input = {
      documentId: 'INV-2026-0011',
      issueDate: '2026-08-25',
      dueDate: '2026-09-25',
      invoiceType: 'TAX_INVOICE' as const,
      documentCurrencyCode: 'AED',
      seller: standardSeller,
      buyer: standardBuyer,
      lines: [
        {
          lineId: '1',
          itemName: 'Item A',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 10.33,
          taxCategoryCode: 'S' as const,
        },
        {
          lineId: '2',
          itemName: 'Item B',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 20.67,
          taxCategoryCode: 'S' as const,
        },
        {
          lineId: '3',
          itemName: 'Item C',
          quantity: 1,
          unitOfMeasureCode: 'EA',
          unitPrice: 15.45,
          taxCategoryCode: 'S' as const,
        },
      ],
      paymentMeansCode: '30',
    };

    const result = engine.calculate(input);
    expect(result.lineExtensionAmount.toFixed(2)).toBe('46.45');
    expect(result.taxBreakdown[0].taxAmount.toFixed(2)).toBe('2.32');
    expect(result.totalVatAmountAed.toFixed(2)).toBe('2.32');
    expect(result.taxInclusiveAmount.toFixed(2)).toBe('48.77');
  });

  it('Version Factory correctly selects engine based on issue date', () => {
    const legacyEngine = UaeVatEngineFactory.getEngineByDate('2025-12-31');
    expect(legacyEngine.version).toBe('2018.1');

    const modernEngine = UaeVatEngineFactory.getEngineByDate('2026-07-01');
    expect(modernEngine.version).toBe('2026.1');
  });
});
