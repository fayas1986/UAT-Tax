import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { decrypt } from '../utils/crypto.js';
import { signJwt } from '../utils/jwt.js';
import { verifyPassword, hashPassword, needsRehash } from '../utils/password.js';

const router = Router();

const defaultCompanyName = process.env.COMPANY_REGISTERED_NAME || 'Alwadi Trading L.L.C.';

// ─── Test-Only Fallback Registry (Strictly disabled in production) ──
export const FALLBACK_USERS: Record<string, { id: string; email: string; password: string; name: string; role: string; company_name: string; company_id?: number }> = process.env.NODE_ENV === 'test' ? {
    'superadmin@alwadipoultry.com': {
        id: 'u-001', email: 'superadmin@alwadipoultry.com', password: hashPassword('Zatca#Secure!2026'),
        name: 'Super Admin', role: 'SUPER_ADMIN', company_name: defaultCompanyName, company_id: 1
    },
    'admin@alwadipoultry.com': {
        id: 'u-002', email: 'admin@alwadipoultry.com', password: hashPassword('SecureAdmin#2026!'),
        name: 'IT Administrator', role: 'IT_ADMIN', company_name: defaultCompanyName, company_id: 1
    }
} : {};

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User Login
 *     description: Authenticate a user with email and cryptographically verified password.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Internal server error
 */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const startTime = Date.now();

    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // ── Step 1: Database Lookup (Mandatory Primary Source of Truth) ──────
        let dbUser: any = null;
        try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 10000));
            const queryPromise = prisma.user.findFirst({
                where: {
                    email: {
                        equals: normalizedEmail,
                        mode: 'insensitive'
                    }
                }
            });
            
            dbUser = await Promise.race([queryPromise, timeoutPromise]);
        } catch (dbErr: any) {
            console.warn(`[Auth] DB lookup error/timeout for ${normalizedEmail}: ${dbErr.message}`);
        }

        // ── Step 2: Handle DB User Authentication ─────────────────────────────
        if (dbUser) {
            const isMatch = verifyPassword(password, dbUser.password, decrypt);

            if (isMatch) {
                // Transparent Automatic Password Rehash Migration to salted scrypt
                if (needsRehash(dbUser.password)) {
                    prisma.user.update({
                        where: { id: dbUser.id },
                        data: { password: hashPassword(password) }
                    }).then(() => {
                        console.log(`[Auth Security] Upgraded legacy password for user ${normalizedEmail} to salted scrypt.`);
                    }).catch(rehashErr => {
                        console.error('[Auth Security] Automatic rehash failed:', rehashErr);
                    });
                }

                let company: any = null;
                try {
                    company = await prisma.company.findFirst({
                        where: { user_id: dbUser.id }
                    });

                    if (!company && dbUser.company_name) {
                        company = await prisma.company.findFirst({
                            where: {
                                registered_name: {
                                    equals: dbUser.company_name,
                                    mode: 'insensitive'
                                }
                            }
                        });
                    }
                } catch (compErr: any) {
                    console.warn(`[Auth] Company lookup error for ${normalizedEmail}: ${compErr.message}`);
                }

                const token = signJwt({
                    userId: dbUser.id,
                    email: dbUser.email,
                    role: dbUser.role,
                    companyId: company?.id || 1
                });

                return res.json({
                    id: dbUser.id,
                    email: dbUser.email,
                    name: dbUser.name || dbUser.email.split('@')[0],
                    role: dbUser.role,
                    token,
                    companyName: company?.registered_name || dbUser.company_name || defaultCompanyName,
                    companyId: company?.id || 1,
                    source: 'database'
                });
            } else {
                console.warn(`[Auth] Password mismatch for DB user ${normalizedEmail}`);
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        }

        // ── Step 3: Test Environment Fallback (Disabled in Production) ─────────
        if (process.env.NODE_ENV === 'test') {
            const fallback = FALLBACK_USERS[normalizedEmail];
            if (fallback && verifyPassword(password, fallback.password)) {
                const token = signJwt({
                    userId: fallback.id,
                    email: fallback.email,
                    role: fallback.role,
                    companyId: fallback.company_id || 1
                });

                return res.json({
                    id: fallback.id,
                    email: fallback.email,
                    name: fallback.name,
                    role: fallback.role,
                    token,
                    companyName: fallback.company_name,
                    companyId: fallback.company_id || 1,
                    source: 'test_fallback'
                });
            }
        }

        // ── Step 4: Final Rejection ───────────────────────────────────────────
        return res.status(401).json({ error: 'Invalid credentials' });

    } catch (error: any) {
        console.error('[Auth] Login error:', error);
        return res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

export default router;
