import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JurisdictionConfig, JurisdictionConfigurationException } from '../config/jurisdiction.js';
import { requireJurisdiction } from '../middleware/jurisdictionMiddleware.js';
import prisma from '../lib/prisma.js';
import { AuditService } from '../services/auditService.js';

describe('Jurisdiction Authorization & Deployment Safety Suite', () => {

  describe('1. Deployment Configuration Safety (JurisdictionConfig)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      JurisdictionConfig.resetForTesting();
    });

    afterEach(() => {
      process.env = originalEnv;
      JurisdictionConfig.resetForTesting();
    });

    it('should throw JurisdictionConfigurationException in production if DEPLOYMENT_REGION is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEPLOYMENT_REGION;

      expect(() => {
        JurisdictionConfig.initialize();
      }).toThrow(JurisdictionConfigurationException);
    });

    it('should throw in production if DEPLOYMENT_REGION is set to "ALL"', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEPLOYMENT_REGION = 'ALL';

      expect(() => {
        JurisdictionConfig.initialize();
      }).toThrow(JurisdictionConfigurationException);
    });

    it('should throw if DEPLOYMENT_REGION is invalid (e.g. "US" or "XYZ")', () => {
      process.env.DEPLOYMENT_REGION = 'XYZ';

      expect(() => {
        JurisdictionConfig.initialize();
      }).toThrow(JurisdictionConfigurationException);
    });

    it('should accept valid "SA" and "AE" in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEPLOYMENT_REGION = 'SA';
      expect(JurisdictionConfig.initialize()).toBe('SA');
      expect(JurisdictionConfig.isSaudiEnabled()).toBe(true);
      expect(JurisdictionConfig.isUaeEnabled()).toBe(false);

      JurisdictionConfig.resetForTesting();
      process.env.DEPLOYMENT_REGION = 'AE';
      expect(JurisdictionConfig.initialize()).toBe('AE');
      expect(JurisdictionConfig.isUaeEnabled()).toBe(true);
      expect(JurisdictionConfig.isSaudiEnabled()).toBe(false);
    });

    it('should permit "ALL" in non-production development environments', () => {
      process.env.NODE_ENV = 'development';
      process.env.DEPLOYMENT_REGION = 'ALL';
      expect(JurisdictionConfig.initialize()).toBe('ALL');
      expect(JurisdictionConfig.isSaudiEnabled()).toBe(true);
      expect(JurisdictionConfig.isUaeEnabled()).toBe(true);
    });
  });

  describe('2. Hardened Jurisdiction Gateway (requireJurisdiction)', () => {
    beforeEach(() => {
      JurisdictionConfig.resetForTesting();
      JurisdictionConfig.initialize('ALL'); // Non-prod test profile
      vi.restoreAllMocks();
    });

    it('should reject unauthenticated request with 401', async () => {
      const mw = requireJurisdiction('AE');
      const req: any = {};
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request missing companyId with 400', async () => {
      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'usr-1', role: 'IT_ADMIN' },
        params: {},
        body: {},
        query: {}
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 404 stealth denial if requested jurisdiction is disabled in deployment region', async () => {
      JurisdictionConfig.resetForTesting();
      JurisdictionConfig.initialize('SA'); // Saudi-only deployment

      const mw = requireJurisdiction('AE'); // Requesting UAE endpoint
      const req: any = {
        user: { userId: 'usr-1', role: 'IT_ADMIN' },
        params: { companyId: '1' }
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    it('should strictly REJECT company with missing or null jurisdiction (never default to SA)', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 10,
        country: null as any,
        registered_name: 'Unspecified Corp'
      } as any);

      const mw = requireJurisdiction('SA');
      const req: any = {
        user: { userId: 'usr-1', role: 'IT_ADMIN', authorizedCompanyIds: [10] },
        params: { companyId: '10' }
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Invalid Jurisdiction'
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should REJECT cross-jurisdiction attempt (Saudi company attempting UAE endpoint)', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 20,
        country: 'SA',
        registered_name: 'Saudi Enterprise Ltd'
      } as any);

      const mw = requireJurisdiction('AE'); // Endpoint requires AE
      const req: any = {
        user: { userId: 'usr-1', role: 'IT_ADMIN', authorizedCompanyIds: [20] },
        params: { companyId: '20' }
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Cross-Jurisdiction Violation'
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should REJECT cross-tenant access when user has no verified membership for company', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 30,
        country: 'AE',
        registered_name: 'UAE Enterprise LLC'
      } as any);

      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'usr-attacker', role: 'FINANCE_ADMIN', authorizedCompanyIds: [99] }, // Member of 99, not 30
        params: { companyId: '30' },
        originalUrl: '/api/uae/invoices',
        method: 'POST'
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Forbidden: Cross-Tenant Access Denied'
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should REJECT SUPER_ADMIN on operational compliance routes without verified membership (NO ROLE BYPASS)', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 40,
        country: 'AE',
        registered_name: 'Target Company LLC'
      } as any);

      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'sysadmin', role: 'SUPER_ADMIN', authorizedCompanyIds: [1] }, // Admin has no link to 40
        params: { companyId: '40' },
        originalUrl: '/api/uae/invoices/sign',
        method: 'POST',
        headers: {}
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      // Operational routes strictly deny cross-tenant access even to SUPER_ADMIN!
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow SUPER_ADMIN on read-only report routes ONLY when explicit audit reason is provided', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 50,
        country: 'AE',
        registered_name: 'Audited Company LLC'
      } as any);

      const auditSpy = vi.spyOn(AuditService, 'log').mockResolvedValue({} as any);

      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'sysadmin', email: 'ciso@alwadi.com', role: 'SUPER_ADMIN', authorizedCompanyIds: [] },
        params: { companyId: '50' },
        originalUrl: '/api/admin/reports/vat-summary',
        method: 'GET',
        headers: {
          'x-admin-audit-reason': 'Mandatory statutory audit inspection requested by CISO ticket SEC-902'
        }
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(auditSpy).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should FAIL CLOSED with 500 if audit logging fails during cross-region admin inspection', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 50,
        country: 'AE',
        registered_name: 'Audited Company LLC'
      } as any);

      vi.spyOn(AuditService, 'log').mockRejectedValue(new Error('Database disk full / connection timeout'));

      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'sysadmin', email: 'ciso@alwadi.com', role: 'SUPER_ADMIN', authorizedCompanyIds: [] },
        params: { companyId: '50' },
        originalUrl: '/api/admin/reports/vat-summary',
        method: 'GET',
        headers: {
          'x-admin-audit-reason': 'Mandatory statutory audit inspection'
        }
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      // Must FAIL CLOSED!
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Security Audit Failure'
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should succeed when tenant is verified member and legal jurisdiction matches', async () => {
      vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({
        id: 100,
        country: 'AE',
        registered_name: 'Valid Tenant LLC'
      } as any);

      const mw = requireJurisdiction('AE');
      const req: any = {
        user: { userId: 'usr-legit', role: 'FINANCE_ADMIN', authorizedCompanyIds: [100] },
        params: { companyId: '100' },
        originalUrl: '/api/uae/invoices',
        method: 'POST'
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      const next = vi.fn();

      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
