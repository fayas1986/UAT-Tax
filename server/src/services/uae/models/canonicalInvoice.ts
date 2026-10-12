/**
 * UAE Canonical Invoice Model & Enums
 * Aligned with Ministerial Decisions No. 243 & 244 of 2025, No. 66 & 168 of 2026,
 * and Peppol PINT AE Specifications.
 */

import { Decimal } from '../utils/decimal.js';

export const PINT_AE_CUSTOMIZATION_ID = 'urn:peppol:pint:billing-1@ae-1';
export const PINT_AE_PROFILE_ID = 'urn:peppol:bis:billing';

// Statutory Fallback Endpoints per UAE eInvoicing Guidelines V1.1
export const FALLBACK_ENDPOINT_DEEMED = '0235:9900000097';
export const FALLBACK_ENDPOINT_UNREGISTERED = '0235:9900000098';
export const FALLBACK_ENDPOINT_EXPORT = '0235:9900000099';

export type UaeInvoiceType =
  | 'TAX_INVOICE'              // Standard B2B / B2G Tax Invoice
  | 'TAX_CREDIT_NOTE'         // Electronic Tax Credit Note
  | 'COMMERCIAL_INVOICE'       // Commercial Invoice (Non-VAT / Exempt / Out of Scope)
  | 'COMMERCIAL_CREDIT_NOTE'   // Commercial Credit Note
  | 'SELF_BILLED_TAX_INVOICE'  // Self-billed Tax Invoice
  | 'SELF_BILLED_CREDIT_NOTE'; // Self-billed Credit Note

export type LegalRegistrationType = 'TL' | 'EID' | 'PAS' | 'CD';

export type UaeTaxCategory =
  | 'S'   // Standard Rate (5%)
  | 'Z'   // Zero Rated (0%)
  | 'E'   // Exempt from VAT
  | 'O'   // Outside the scope of UAE VAT
  | 'AE'  // Domestic Reverse Charge Mechanism (RCM)
  | 'M';  // Profit Margin Scheme

export interface UaeAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countrySubdivision: string; // Emirate (e.g., 'Dubai', 'Abu Dhabi')
  postalZone?: string;
  countryCode: 'AE' | string;
}

export interface UaePartyLegalRegistration {
  id: string;
  type: LegalRegistrationType;
  issuingAuthority?: string;
}

export interface UaeParty {
  name: string;
  tin: string;                   // 10-digit Tax Identification Number
  trn?: string;                  // 15-digit VAT Registration Number
  participantId: string;         // '0235:' + TIN or fallback
  legalRegistration: UaePartyLegalRegistration;
  address: UaeAddress;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UaeBeneficiaryParty {
  beneficiaryName: string;
  beneficiaryId: string;
  beneficiaryAddress?: UaeAddress;
}

export interface UaeTransactionBitmask {
  isFreeTradeZone: boolean;      // Bit 1
  isDeemedSupply: boolean;       // Bit 2
  isMarginScheme: boolean;       // Bit 3
  isSummaryInvoice: boolean;     // Bit 4
  isContinuousSupply: boolean;   // Bit 5
  isDisclosedAgent: boolean;     // Bit 6
  isEcommerceSupply: boolean;    // Bit 7
  isExport: boolean;             // Bit 8
}

export interface UaePrecedingInvoiceRef {
  invoiceNumber: string;
  issueDate: string;             // YYYY-MM-DD
  uuid?: string;
  creditReasonCode: string;      // e.g. 'CANCELLATION', 'DISCOUNT', 'ERROR'
  creditReasonDescription: string;
}

export interface UaeInvoiceLine {
  lineId: string;
  itemType?: 'G' | 'S' | 'B';    // 'G' (Goods), 'S' (Services), 'B' (Both)
  itemName: string;
  itemDescription?: string;
  invoicedQuantity: Decimal;
  unitOfMeasureCode: string;     // UN/ECE Rec 20
  itemGrossPrice: Decimal;
  itemDiscountAmount?: Decimal;
  itemNetPrice: Decimal;
  priceBaseQuantity: Decimal;
  lineNetAmount: Decimal;        // invoicedQuantity * itemNetPrice
  
  // Tax Details
  taxCategoryCode: UaeTaxCategory;
  taxRatePercentage: Decimal;    // 5.00 for 'S', 0.00 for others
  taxAmount: Decimal;            // Line tax in document currency
  
  // Statutory Dual Currency Fields in AED
  vatLineAmountAed: Decimal;     // Mandatory for Tax Invoices
  lineAmountAed: Decimal;        // Mandatory Line Payable in AED (Net + VAT in AED)
  
  // Domestic RCM Goods Reference
  rcmReference?: 'ELECTRONIC_DEVICES' | 'PRECIOUS_METALS' | 'CRUDE_OIL' | 'NATURAL_GAS' | 'METAL_SCRAP';
}

export interface UaeTaxBreakdownItem {
  taxCategoryCode: UaeTaxCategory;
  taxRatePercentage: Decimal;
  taxableAmount: Decimal;
  taxAmount: Decimal;
  taxableAmountAed: Decimal;
  taxAmountAed: Decimal;
  exemptionReasonText?: string;
}

export interface UaeCanonicalInvoice {
  schemaVersion: '1.0';
  taxRuleVersion: string;        // e.g. '2026.1' or '2018.1'
  documentId: string;            // Business Invoice Number
  uuid: string;                  // RFC 4122 compliant 128-bit UUID
  issueDate: string;             // YYYY-MM-DD
  issueTime?: string;            // HH:mm:ss
  supplyDate?: string;           // VAT Point Date
  dueDate: string;               // YYYY-MM-DD
  invoiceType: UaeInvoiceType;
  invoiceTypeCode: '380' | '381' | '388';
  isTaxInvoice: boolean;
  
  // Transaction Classification
  transactionBitmask: UaeTransactionBitmask;
  transactionTypeCode: string;   // 8-character string, e.g. '00000000'
  
  // Currency & Central Bank FX
  documentCurrencyCode: string;
  taxAccountingCurrencyCode: 'AED';
  exchangeRateToAed?: Decimal;
  exchangeRateSourceDate?: string;
  
  // Parties
  seller: UaeParty;
  buyer: UaeParty;
  beneficiary?: UaeBeneficiaryParty;
  
  // Preceding References (Mandatory for Credit Notes)
  precedingInvoiceReferences?: UaePrecedingInvoiceRef[];
  
  // Lines & Breakdown
  lines: UaeInvoiceLine[];
  taxBreakdown: UaeTaxBreakdownItem[];
  
  // Monetary Totals (Document Currency)
  lineExtensionAmount: Decimal;
  taxExclusiveAmount: Decimal;
  taxInclusiveAmount: Decimal;
  totalTaxAmount: Decimal;
  allowanceTotalAmount: Decimal;
  chargeTotalAmount: Decimal;
  prepaidAmount: Decimal;
  roundingAmount: Decimal;
  payableAmount: Decimal;
  
  // Statutory Dual Currency Totals in AED
  totalVatAmountAed: Decimal;
  totalPayableAmountAed: Decimal;
  
  // Payment Information
  paymentMeansCode: string;
  paymentTerms?: string;

  // Regulatory & Audit Provenance
  calculationAuditTrail?: {
    statutoryRule: 'ARTICLE_61_HALF_UP';
    internalScalePrecision: number;
    calculationTimestamp: string;
    fxSource?: string;
    fxSourceDate?: string;
    fxRateApplied?: Decimal;
  };
}

/**
 * Encodes an 8-bit transaction structure into an official 8-character bitmask string.
 */
export function encodeTransactionBitmask(bitmask: UaeTransactionBitmask): string {
  const flags = [
    bitmask.isFreeTradeZone ? '1' : '0',
    bitmask.isDeemedSupply ? '1' : '0',
    bitmask.isMarginScheme ? '1' : '0',
    bitmask.isSummaryInvoice ? '1' : '0',
    bitmask.isContinuousSupply ? '1' : '0',
    bitmask.isDisclosedAgent ? '1' : '0',
    bitmask.isEcommerceSupply ? '1' : '0',
    bitmask.isExport ? '1' : '0',
  ];
  return flags.join('');
}

/**
 * Parses an 8-character bitmask string into strongly typed flags.
 */
export function parseTransactionBitmask(code: string): UaeTransactionBitmask {
  if (!code || code.length !== 8 || !/^[01]{8}$/.test(code)) {
    throw new Error(`Invalid transaction type code bitmask: "${code}". Must be exactly 8 binary characters.`);
  }
  return {
    isFreeTradeZone: code[0] === '1',
    isDeemedSupply: code[1] === '1',
    isMarginScheme: code[2] === '1',
    isSummaryInvoice: code[3] === '1',
    isContinuousSupply: code[4] === '1',
    isDisclosedAgent: code[5] === '1',
    isEcommerceSupply: code[6] === '1',
    isExport: code[7] === '1',
  };
}

/**
 * Generates official Peppol Participant ID for UAE entity from 10-digit TIN.
 */
export function formatParticipantId(tin: string): string {
  const cleanTin = tin.trim();
  if (!/^\d{10}$/.test(cleanTin)) {
    throw new Error(`Invalid UAE TIN: "${tin}". Must be exactly 10 numeric digits.`);
  }
  return `0235:${cleanTin}`;
}
