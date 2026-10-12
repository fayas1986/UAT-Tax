import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware.js';
import { JurisdictionConfig } from '../config/jurisdiction.js';
import prisma from '../lib/prisma.js';
import { AuditService } from '../services/auditService.js';

export class JurisdictionSecurityException extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number = 403) {
    super(message);
    this.name = 'JurisdictionSecurityException';
  }
}

/**
 * Hardened Jurisdiction Gateway Middleware
 * Enforces:
 *  1. Regional deployment profile match (404 stealth denial if country disabled in region).
 *  2. Server-side database company lookup with strict legal jurisdiction validation.
 *  3. Rejection of missing, null, or unknown company country (never defaults to SA).
 *  4. Strict server-side company membership verification (no SUPER_ADMIN bypass on operational routes).
 *  5. Explicit, audited cross-region admin access strictly on read-only endpoints, failing closed on audit log failure.
 */
export const requireJurisdiction = (requiredCountry: 'SA' | 'AE') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // 1. Regional Profile Gate (via centralized JurisdictionConfig)
      const isCountryActive = requiredCountry === 'SA' 
        ? JurisdictionConfig.isSaudiEnabled() 
        : JurisdictionConfig.isUaeEnabled();

      if (!isCountryActive) {
        return res.status(404).json({
          error: 'Not Found',
          message: `The requested jurisdiction '${requiredCountry}' is not enabled in this deployment region (${JurisdictionConfig.getActiveRegion()}).`
        });
      }

      // 2. Authentication Verification
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required before accessing jurisdiction compliance workflows.'
        });
      }

      // 3. Resolve Target Company ID from request
      const rawCompanyId = req.params.companyId || req.body?.companyId || req.query?.companyId || req.user.companyId;
      const targetCompanyId = typeof rawCompanyId === 'string' ? parseInt(rawCompanyId, 10) : Number(rawCompanyId);

      if (!targetCompanyId || isNaN(targetCompanyId)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'A valid target companyId is required to verify legal jurisdiction.'
        });
      }

      // 4. Resolve Trusted Company Record from Database
      const company = await prisma.company.findUnique({
        where: { id: targetCompanyId, is_deleted: false },
        select: { id: true, country: true, registered_name: true }
      });

      if (!company) {
        return res.status(404).json({
          error: 'Company Not Found',
          message: `Company ID ${targetCompanyId} does not exist or has been deleted.`
        });
      }

      // 5. Strict Jurisdiction Validation (NEVER default to 'SA')
      const rawCountry = company.country;
      if (!rawCountry || typeof rawCountry !== 'string') {
        return res.status(403).json({
          error: 'Invalid Jurisdiction',
          message: `Company ${targetCompanyId} has no configured legal jurisdiction. Missing country is strictly rejected.`
        });
      }

      const normalizedCountry = rawCountry.trim().toUpperCase();
      if (normalizedCountry !== 'SA' && normalizedCountry !== 'AE') {
        return res.status(403).json({
          error: 'Invalid Jurisdiction',
          message: `Company ${targetCompanyId} has an unsupported legal jurisdiction '${rawCountry}'. Must be 'SA' or 'AE'.`
        });
      }

      if (normalizedCountry !== requiredCountry) {
        return res.status(403).json({
          error: 'Cross-Jurisdiction Violation',
          message: `Company ${targetCompanyId} belongs to jurisdiction '${normalizedCountry}' and cannot execute '${requiredCountry}' compliance workflows.`
        });
      }

      // 6. Enforce Verified Server-Side Company Membership (NO SUPER_ADMIN BYPASS on transactional routes)
      const userAuthorizedIds = req.user.authorizedCompanyIds || [];
      const hasVerifiedMembership = userAuthorizedIds.includes(targetCompanyId);

      if (hasVerifiedMembership) {
        return next();
      }

      // 7. Handle Unlinked Accounts (Check for explicitly authorized, audited read-only admin inspection)
      const isReadOnlyMethod = req.method === 'GET';
      const url = req.originalUrl || req.url || '';
      const isReportRoute = url.includes('/reports') || url.includes('/admin/reports');
      const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
      const auditReasonHeader = req.headers ? (req.headers['x-admin-audit-reason'] as string | undefined) : undefined;

      const isAuditedAdminRead = isReadOnlyMethod && isReportRoute && isSuperAdmin;

      if (isAuditedAdminRead) {
        // Validate audit reason
        if (!auditReasonHeader || auditReasonHeader.trim().length < 10) {
          return res.status(403).json({
            error: 'Audit Reason Required',
            message: 'Cross-company administrative inspection requires an explicit, documented "x-admin-audit-reason" header (minimum 10 characters).'
          });
        }

        // Durable audit logging (FAIL CLOSED: if audit logging fails, access is DENIED)
        try {
          await AuditService.log({
            action: 'CROSS_REGION_ADMIN_INSPECTION',
            category: 'SECURITY_AUDIT',
            user: req.user.email || req.user.userId,
            role: req.user.role,
            ip_address: req.ip || 'unknown',
            details: `Cross-region audit inspection of company ${targetCompanyId} (${company.registered_name}) by SUPER_ADMIN. Justification: ${auditReasonHeader.trim()}`,
            status: 'SUCCESS',
            resource_id: String(targetCompanyId),
            metadata: {
              url: req.originalUrl,
              method: req.method,
              companyCountry: normalizedCountry,
              requiredJurisdiction: requiredCountry
            }
          });
        } catch (auditErr: any) {
          console.error('[JurisdictionGateway] Audit log failure — FAILING CLOSED:', auditErr);
          return res.status(500).json({
            error: 'Security Audit Failure',
            message: 'Security audit logging failed. Access is denied to preserve audit integrity.'
          });
        }

        return next();
      }

      // Deny all other unlinked attempts (operational routes cannot be bypassed by any role)
      return res.status(403).json({
        error: 'Forbidden: Cross-Tenant Access Denied',
        message: `User ${req.user.userId} has no verified membership for company ${targetCompanyId}. Operational compliance workflows cannot be bypassed by administrative roles.`
      });

    } catch (err: any) {
      console.error('[JurisdictionGateway] Gateway exception:', err);
      return res.status(500).json({
        error: 'Internal Authorization Error',
        message: 'An unexpected error occurred during jurisdiction authorization verification.'
      });
    }
  };
};
