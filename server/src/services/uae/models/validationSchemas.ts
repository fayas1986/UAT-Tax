/**
 * UAE Compliance Validation Schemas (Zod)
 * Validates ERP input payloads and canonical documents against UAE rules.
 */

import { z } from 'zod';
import {
  FALLBACK_ENDPOINT_DEEMED,
  FALLBACK_ENDPOINT_UNREGISTERED,
  FALLBACK_ENDPOINT_EXPORT,
} from './canonicalInvoice.js';

export const AddressSchema = z.object({
  addressLine1: z.string().min(1, 'Address Line 1 is mandatory'),
  addressLine2: z.string().optional(),
  city: z.string().min(1, 'City is mandatory'),
  countrySubdivision: z.string().min(1, 'Country Subdivision (Emirate) is mandatory'),
  postalZone: z.string().optional(),
  countryCode: z.string().length(2, 'Country code must be 2-letter ISO code'),
});

export const LegalRegistrationSchema = z.object({
  id: z.string().min(1, 'Registration identifier is mandatory'),
  type: z.enum(['TL', 'EID', 'PAS', 'CD'], {
    errorMap: () => ({ message: 'Legal registration type must be one of: TL, EID, PAS, CD' }),
  }),
  issuingAuthority: z.string().optional(),
});

export const ParticipantIdSchema = z.string().regex(
  /^0235:(\d{10}|9900000097|9900000098|9900000099)$/,
  'Participant ID must follow format 0235:<10-digit TIN> or official fallback endpoint (9900000097, 9900000098, 9900000099)'
);

export const PartySchema = z.object({
  name: z.string().min(1, 'Party legal name is mandatory'),
  tin: z.string().regex(/^\d{10}$/, 'TIN must be exactly 10 numeric digits'),
  trn: z.string().regex(/^\d{15}$/, 'TRN must be exactly 15 numeric digits').optional(),
  participantId: ParticipantIdSchema,
  legalRegistration: LegalRegistrationSchema,
  address: AddressSchema,
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
});

export const BeneficiaryPartySchema = z.object({
  beneficiaryName: z.string().min(1, 'Beneficiary Name is mandatory for Free Zone transactions'),
  beneficiaryId: z.string().min(1, 'Beneficiary ID is mandatory for Free Zone transactions'),
  beneficiaryAddress: AddressSchema.optional(),
});

export const TransactionBitmaskStringSchema = z.string().regex(
  /^[01]{8}$/,
  'Transaction type bitmask must be exactly 8 binary digits (e.g. 00000000)'
);

export const PrecedingInvoiceRefSchema = z.object({
  invoiceNumber: z.string().min(1, 'Preceding invoice number is mandatory for credit notes'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD'),
  uuid: z.string().uuid().optional(),
  creditReasonCode: z.string().min(1, 'Credit reason code is mandatory'),
  creditReasonDescription: z.string().min(1, 'Credit reason description is mandatory'),
});

export const TaxCategorySchema = z.enum(['S', 'Z', 'E', 'O', 'AE', 'M']);

export const InvoiceLineInputSchema = z.object({
  lineId: z.string().min(1),
  itemType: z.enum(['G', 'S', 'B']).optional(),
  itemName: z.string().min(1, 'Item name is mandatory'),
  itemDescription: z.string().optional(),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitOfMeasureCode: z.string().min(1, 'Unit of measure code is mandatory'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),
  discountAmount: z.number().nonnegative().optional(),
  taxCategoryCode: TaxCategorySchema,
  customTaxRate: z.number().optional(), // In case rate override is provided
  exemptionReasonText: z.string().optional(),
  rcmReference: z.enum([
    'ELECTRONIC_DEVICES',
    'PRECIOUS_METALS',
    'CRUDE_OIL',
    'NATURAL_GAS',
    'METAL_SCRAP',
  ]).optional(),
});

export const InvoiceCalculationInputSchema = z.object({
  documentId: z.string().min(1, 'Document ID is mandatory'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD'),
  issueTime: z.string().optional(),
  supplyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  invoiceType: z.enum([
    'TAX_INVOICE',
    'TAX_CREDIT_NOTE',
    'COMMERCIAL_INVOICE',
    'COMMERCIAL_CREDIT_NOTE',
    'SELF_BILLED_TAX_INVOICE',
    'SELF_BILLED_CREDIT_NOTE',
  ]),
  documentCurrencyCode: z.string().length(3, 'Currency must be 3-letter ISO code'),
  exchangeRateToAed: z.number().positive().optional(),
  exchangeRateSourceDate: z.string().optional(),
  seller: PartySchema,
  buyer: PartySchema,
  beneficiary: BeneficiaryPartySchema.optional(),
  transactionBitmask: TransactionBitmaskStringSchema.default('00000000'),
  precedingInvoiceReferences: z.array(PrecedingInvoiceRefSchema).optional(),
  lines: z.array(InvoiceLineInputSchema).min(1, 'Invoice must have at least one line item'),
  documentAllowances: z.number().nonnegative().optional(),
  documentCharges: z.number().nonnegative().optional(),
  prepaidAmount: z.number().nonnegative().optional(),
  roundingAmount: z.number().optional(),
  paymentMeansCode: z.string().default('30'),
  paymentTerms: z.string().optional(),
});

export type RawInvoiceCalculationInput = z.infer<typeof InvoiceCalculationInputSchema>;
