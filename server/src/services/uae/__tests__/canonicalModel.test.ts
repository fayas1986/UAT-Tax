import { describe, it, expect } from 'vitest';
import {
  encodeTransactionBitmask,
  parseTransactionBitmask,
  formatParticipantId,
  FALLBACK_ENDPOINT_DEEMED,
  FALLBACK_ENDPOINT_UNREGISTERED,
  FALLBACK_ENDPOINT_EXPORT,
} from '../models/canonicalInvoice.js';
import {
  AddressSchema,
  LegalRegistrationSchema,
  ParticipantIdSchema,
  PartySchema,
  TransactionBitmaskStringSchema,
} from '../models/validationSchemas.js';

describe('UAE Canonical Model & Validation Schemas', () => {
  describe('Transaction Bitmask', () => {
    it('should encode standard B2B transaction as 00000000', () => {
      const bitmask = {
        isFreeTradeZone: false,
        isDeemedSupply: false,
        isMarginScheme: false,
        isSummaryInvoice: false,
        isContinuousSupply: false,
        isDisclosedAgent: false,
        isEcommerceSupply: false,
        isExport: false,
      };
      expect(encodeTransactionBitmask(bitmask)).toBe('00000000');
    });

    it('should encode specific flags in exact official order', () => {
      // Bit 1: Free Zone, Bit 8: Export
      const bitmask = {
        isFreeTradeZone: true,
        isDeemedSupply: false,
        isMarginScheme: false,
        isSummaryInvoice: false,
        isContinuousSupply: false,
        isDisclosedAgent: false,
        isEcommerceSupply: false,
        isExport: true,
      };
      expect(encodeTransactionBitmask(bitmask)).toBe('10000001');
    });

    it('should correctly parse 8-character bitmask string', () => {
      const parsed = parseTransactionBitmask('01000010');
      expect(parsed.isFreeTradeZone).toBe(false);
      expect(parsed.isDeemedSupply).toBe(true);  // Bit 2
      expect(parsed.isEcommerceSupply).toBe(true); // Bit 7
      expect(parsed.isExport).toBe(false);
    });

    it('should throw on invalid bitmask lengths or non-binary characters', () => {
      expect(() => parseTransactionBitmask('0000')).toThrow();
      expect(() => parseTransactionBitmask('00000002')).toThrow();
      expect(() => parseTransactionBitmask('ABCDEFGH')).toThrow();
    });
  });

  describe('Participant ID & TIN formatting', () => {
    it('should generate official participant endpoint from valid 10-digit TIN', () => {
      expect(formatParticipantId('1001234567')).toBe('0235:1001234567');
    });

    it('should reject invalid TIN lengths or non-numeric strings', () => {
      expect(() => formatParticipantId('12345')).toThrow(); // 5 digits
      expect(() => formatParticipantId('123456789012345')).toThrow(); // 15 digits (TRN, not TIN)
      expect(() => formatParticipantId('100123456A')).toThrow();
    });

    it('should validate official fallback endpoints with Zod schema', () => {
      expect(ParticipantIdSchema.safeParse(FALLBACK_ENDPOINT_DEEMED).success).toBe(true);
      expect(ParticipantIdSchema.safeParse(FALLBACK_ENDPOINT_UNREGISTERED).success).toBe(true);
      expect(ParticipantIdSchema.safeParse(FALLBACK_ENDPOINT_EXPORT).success).toBe(true);
      expect(ParticipantIdSchema.safeParse('0235:1001234567').success).toBe(true);
      expect(ParticipantIdSchema.safeParse('0235:9999999999').success).toBe(true);
      expect(ParticipantIdSchema.safeParse('0199:1001234567').success).toBe(false); // wrong scheme
    });
  });

  describe('Legal Registration Types', () => {
    it('should accept valid registration schemes (TL, EID, PAS, CD)', () => {
      for (const scheme of ['TL', 'EID', 'PAS', 'CD']) {
        const result = LegalRegistrationSchema.safeParse({ id: '123456', type: scheme });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid registration scheme codes', () => {
      const result = LegalRegistrationSchema.safeParse({ id: '123456', type: 'INVALID' });
      expect(result.success).toBe(false);
    });
  });

  describe('Address Validation', () => {
    it('should validate mandatory UAE address elements', () => {
      const validAddress = {
        addressLine1: 'Sheikh Zayed Road, Trade Centre 1',
        city: 'Dubai',
        countrySubdivision: 'Dubai',
        countryCode: 'AE',
      };
      expect(AddressSchema.safeParse(validAddress).success).toBe(true);
    });

    it('should reject address missing city or country subdivision', () => {
      const invalid = {
        addressLine1: 'Sheikh Zayed Road',
        countryCode: 'AE',
      };
      expect(AddressSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
