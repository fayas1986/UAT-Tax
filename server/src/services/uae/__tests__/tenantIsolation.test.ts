import { describe, it, expect } from 'vitest';
import {
  TenantCountryGuard,
  TenantContext,
  TenantSecurityException,
} from '../tenant/tenantContext.js';

describe('Tenant Authorization & Multi-Jurisdiction Country Isolation', () => {
  const saudiTenant: TenantContext = {
    companyId: 101,
    country: 'SA',
    userId: 'usr_sa_001',
    role: 'FINANCE_ADMIN',
  };

  const uaeTenant: TenantContext = {
    companyId: 202,
    country: 'AE',
    userId: 'usr_ae_001',
    role: 'TAX_OFFICER',
  };

  const superAdmin: TenantContext = {
    companyId: 999,
    country: 'AE',
    userId: 'usr_super_001',
    role: 'SUPER_ADMIN',
  };

  describe('Country Boundary Isolation', () => {
    it('should permit UAE tenant for UAE compliance operations', () => {
      expect(() => TenantCountryGuard.assertCountry(uaeTenant, 'AE')).not.toThrow();
    });

    it('should permit Saudi tenant for Saudi ZATCA operations', () => {
      expect(() => TenantCountryGuard.assertCountry(saudiTenant, 'SA')).not.toThrow();
    });

    it('should strictly reject Saudi tenant attempting UAE operations', () => {
      expect(() => TenantCountryGuard.assertCountry(saudiTenant, 'AE')).toThrow(TenantSecurityException);
      try {
        TenantCountryGuard.assertCountry(saudiTenant, 'AE');
      } catch (err: any) {
        expect(err.code).toBe('CROSS_JURISDICTION_VIOLATION');
        expect(err.message).toContain('Cross-jurisdiction violation');
      }
    });

    it('should strictly reject UAE tenant attempting Saudi operations', () => {
      expect(() => TenantCountryGuard.assertCountry(uaeTenant, 'SA')).toThrow(TenantSecurityException);
      try {
        TenantCountryGuard.assertCountry(uaeTenant, 'SA');
      } catch (err: any) {
        expect(err.code).toBe('CROSS_JURISDICTION_VIOLATION');
      }
    });
  });

  describe('Cross-Tenant Data Boundary Protection', () => {
    it('should permit tenant accessing its own company records', () => {
      expect(() => TenantCountryGuard.assertTenantAccess(uaeTenant, 202)).not.toThrow();
    });

    it('should reject tenant attempting to access another company records', () => {
      expect(() => TenantCountryGuard.assertTenantAccess(uaeTenant, 999)).toThrow(TenantSecurityException);
      try {
        TenantCountryGuard.assertTenantAccess(uaeTenant, 999);
      } catch (err: any) {
        expect(err.code).toBe('CROSS_TENANT_ACCESS_DENIED');
      }
    });

    it('should permit SUPER_ADMIN cross-company access', () => {
      expect(() => TenantCountryGuard.assertTenantAccess(superAdmin, 101)).not.toThrow();
      expect(() => TenantCountryGuard.assertTenantAccess(superAdmin, 202)).not.toThrow();
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('should permit user with matching allowed roles', () => {
      expect(() => TenantCountryGuard.assertRole(uaeTenant, ['TAX_OFFICER', 'FINANCE_ADMIN'])).not.toThrow();
    });

    it('should reject user with insufficient role', () => {
      expect(() => TenantCountryGuard.assertRole(uaeTenant, ['IT_ADMIN'])).toThrow(TenantSecurityException);
      try {
        TenantCountryGuard.assertRole(uaeTenant, ['IT_ADMIN']);
      } catch (err: any) {
        expect(err.code).toBe('INSUFFICIENT_ROLE');
      }
    });

    it('should bypass role restriction for SUPER_ADMIN', () => {
      expect(() => TenantCountryGuard.assertRole(superAdmin, ['IT_ADMIN'])).not.toThrow();
    });
  });
});
