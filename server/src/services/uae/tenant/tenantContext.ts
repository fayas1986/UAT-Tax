/**
 * Tenant Authorization & Multi-Jurisdiction Country Isolation Guard
 * Enforces tenant isolation and prevents cross-jurisdiction data leaks
 * between Saudi Arabia (ZATCA) and the United Arab Emirates (FTA).
 */

export type JurisdictionCode = 'SA' | 'AE';
export type UserRole = 'IT_ADMIN' | 'FINANCE_ADMIN' | 'TAX_OFFICER' | 'SUPER_ADMIN';

export interface TenantContext {
  companyId: number;
  country: JurisdictionCode;
  userId: string;
  role: UserRole;
}

export class TenantSecurityException extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TenantSecurityException';
  }
}

export class TenantCountryGuard {
  /**
   * Enforces that the operation matches the tenant's legal jurisdiction.
   * Prevents a Saudi tenant from invoking UAE compliance workflows,
   * or a UAE tenant from invoking Saudi ZATCA signing.
   */
  public static assertCountry(context: TenantContext, requiredCountry: JurisdictionCode): void {
    if (!context) {
      throw new TenantSecurityException('Unauthenticated tenant context', 'TENANT_CONTEXT_MISSING');
    }
    if (context.country !== requiredCountry) {
      throw new TenantSecurityException(
        `Cross-jurisdiction violation: Tenant belongs to '${context.country}' but attempted operation requiring '${requiredCountry}'`,
        'CROSS_JURISDICTION_VIOLATION'
      );
    }
  }

  /**
   * Enforces that a tenant can only access and modify their own company records.
   */
  public static assertTenantAccess(context: TenantContext, targetCompanyId: number): void {
    if (!context) {
      throw new TenantSecurityException('Unauthenticated tenant context', 'TENANT_CONTEXT_MISSING');
    }
    if (context.role === 'SUPER_ADMIN') {
      return; // Super admins may perform platform-level actions
    }
    if (context.companyId !== targetCompanyId) {
      throw new TenantSecurityException(
        `Cross-tenant access denied: Tenant company ${context.companyId} cannot access company ${targetCompanyId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      );
    }
  }

  /**
   * Enforces Role-Based Access Control (RBAC).
   */
  public static assertRole(context: TenantContext, allowedRoles: UserRole[]): void {
    if (!context) {
      throw new TenantSecurityException('Unauthenticated tenant context', 'TENANT_CONTEXT_MISSING');
    }
    if (context.role === 'SUPER_ADMIN') {
      return;
    }
    if (!allowedRoles.includes(context.role)) {
      throw new TenantSecurityException(
        `Insufficient role: User role '${context.role}' not permitted for this operation. Required: ${allowedRoles.join(', ')}`,
        'INSUFFICIENT_ROLE'
      );
    }
  }
}
