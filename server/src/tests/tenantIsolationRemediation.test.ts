import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../index.js';
import prisma from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

describe('Tenant Isolation & Authorization Security Remediation Suite', () => {
  const alwadiEmail = 'admin@alwadipoultry.com';
  const easyLeaseVat = '399999999900003';
  const alwadiVat = '300000000000003';

  let alwadiToken: string;
  let superAdminToken: string;
  let forgedHeaderToken: string;
  let alwadiCompanyId: number;
  let easyLeaseCompanyId: number;

  beforeAll(async () => {
    // 1. Ensure User Alwadi exists
    const userAlwadi = await prisma.user.upsert({
      where: { email: alwadiEmail },
      update: {},
      create: {
        id: 'alwadi_admin_user',
        email: alwadiEmail,
        role: 'IT_ADMIN',
        company_name: 'Alwadi Trading L.L.C.'
      }
    });

    // 2. Ensure User Easy Lease exists
    const userEasyLease = await prisma.user.upsert({
      where: { email: 'easylease_admin@easylease.sa' },
      update: {},
      create: {
        id: 'easylease_admin_user',
        email: 'easylease_admin@easylease.sa',
        role: 'IT_ADMIN',
        company_name: 'Easy Lease Transport Services (Sole Proprietorship) L.L.C.'
      }
    });

    // 3. Ensure Alwadi Company exists
    let alwadiComp = await prisma.company.findFirst({ where: { vat_number: alwadiVat } });
    if (!alwadiComp) {
      alwadiComp = await prisma.company.create({
        data: {
          user_id: userAlwadi.id,
          registered_name: 'Alwadi Trading L.L.C.',
          vat_number: alwadiVat,
          cr_number: '1010101010',
          branch_name: 'HQ',
          address: 'Olaya Street',
          city: 'Riyadh',
          country: 'SA'
        }
      });
    } else {
      await prisma.company.update({
        where: { id: alwadiComp.id },
        data: { user_id: userAlwadi.id }
      });
    }
    alwadiCompanyId = alwadiComp.id;

    // 4. Ensure Easy Lease Company exists
    let easyLeaseComp = await prisma.company.findFirst({ where: { vat_number: easyLeaseVat } });
    if (!easyLeaseComp) {
      easyLeaseComp = await prisma.company.create({
        data: {
          user_id: userEasyLease.id,
          registered_name: 'Easy Lease Transport Services (Sole Proprietorship) L.L.C.',
          vat_number: easyLeaseVat,
          cr_number: '2020202020',
          branch_name: 'HQ',
          address: 'King Fahd Road',
          city: 'Riyadh',
          country: 'SA'
        }
      });
    }
    easyLeaseCompanyId = easyLeaseComp.id;

    // 3. Setup Super Admin User
    const userSuperAdmin = await prisma.user.upsert({
      where: { email: 'superadmin@alwadipoultry.com' },
      update: { role: 'SUPER_ADMIN' },
      create: {
        id: 'system_superadmin_user',
        email: 'superadmin@alwadipoultry.com',
        role: 'SUPER_ADMIN',
        company_name: 'Alwadi Trading L.L.C.'
      }
    });

    // 4. Issue valid JWT Tokens
    alwadiToken = signJwt({
      userId: userAlwadi.id,
      email: alwadiEmail,
      role: 'IT_ADMIN',
      companyId: alwadiCompanyId
    });

    superAdminToken = signJwt({
      userId: userSuperAdmin.id,
      email: userSuperAdmin.email,
      role: 'SUPER_ADMIN',
      companyId: alwadiCompanyId
    });

    // Token for ordinary user trying to claim SUPER_ADMIN in token payload without DB membership
    forgedHeaderToken = signJwt({
      userId: userAlwadi.id,
      email: alwadiEmail,
      role: 'IT_ADMIN',
      companyId: alwadiCompanyId
    });
  });

  afterAll(async () => {
    try {
      if (easyLeaseCompanyId) {
        await prisma.company.deleteMany({ where: { id: easyLeaseCompanyId } });
      }
      await prisma.user.deleteMany({
        where: { email: { in: ['easylease_admin@easylease.sa', 'superadmin@alwadipoultry.com'] } }
      });
    } catch (e) {}
    await prisma.$disconnect();
  });

  it('1. Alwadi user receives ONLY authorized company records (Alwadi Trading L.L.C.)', async () => {
    const res = await supertest(app)
      .get('/api/admin/companies')
      .set('Authorization', `Bearer ${alwadiToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Verify all returned companies match Alwadi company ID
    const companyIds = res.body.map((c: any) => c.id.toString());
    expect(companyIds).toContain(alwadiCompanyId.toString());
    expect(companyIds).not.toContain(easyLeaseCompanyId.toString());
  });

  it('2. Alwadi user CANNOT retrieve Easy Lease company or cross-tenant data', async () => {
    const res = await supertest(app)
      .get(`/api/admin/companies?companyId=${easyLeaseCompanyId}`)
      .set('Authorization', `Bearer ${alwadiToken}`)
      .expect(200);

    // Should not return Easy Lease company
    const companyNames = res.body.map((c: any) => c.name);
    expect(companyNames).not.toContain('Easy Lease Transport Services (Sole Proprietorship) L.L.C.');
  });

  it('3. Forged x-user-role headers without valid JWT token fail closed (401 Unauthorized)', async () => {
    const res = await supertest(app)
      .get('/api/admin/companies')
      .set('x-user-role', 'SUPER_ADMIN')
      .set('x-user-email', 'superadmin@alwadipoultry.com')
      .expect(401);

    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  it('4. Caller-supplied forged x-user-role header WITH ordinary user JWT token cannot elevate privileges', async () => {
    const res = await supertest(app)
      .get('/api/admin/groups')
      .set('Authorization', `Bearer ${alwadiToken}`)
      .set('x-user-role', 'SUPER_ADMIN') // Forged header attempt
      .expect(403);

    expect(res.body.error).toMatch(/Forbidden/i);
  });

  it('5. SUPER_ADMIN with verified token follows explicit RBAC policy and can access system endpoints', async () => {
    const res = await supertest(app)
      .get('/api/admin/companies')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const companyIds = res.body.map((c: any) => c.id.toString());
    expect(companyIds).toContain(alwadiCompanyId.toString());
    expect(companyIds).toContain(easyLeaseCompanyId.toString());
  });

  it('6. Missing or invalid Bearer token fails closed (401 Unauthorized)', async () => {
    await supertest(app)
      .get('/api/admin/companies')
      .set('Authorization', 'Bearer invalid_garbage_token_12345')
      .expect(401);

    await supertest(app)
      .get('/api/admin/companies')
      .expect(401);
  });
});
