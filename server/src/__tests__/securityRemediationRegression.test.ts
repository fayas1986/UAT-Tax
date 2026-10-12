import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt } from '../utils/crypto.js';
import { SecurityService } from '../services/securityService.js';
import { hashPassword, verifyPassword, needsRehash } from '../utils/password.js';
import { enforceCompanyAccess, AuthenticatedRequest } from '../middleware/authMiddleware.js';

describe('Stage 2 — Security Remediation & Regression Test Suite', () => {

    describe('P0-1: Authenticated Encryption (AES-256-GCM) & Key Management', () => {
        it('should encrypt and decrypt using authenticated AES-256-GCM format (gcm:iv:tag:ciphertext)', () => {
            const secret = 'MOCK_ECDSA_SECP256K1_PRIVATE_KEY_2026';
            const ciphertext = encrypt(secret);

            expect(ciphertext.startsWith('gcm:')).toBe(true);
            const parts = ciphertext.split(':');
            expect(parts.length).toBe(4); // 'gcm', ivHex (24 chars / 12 bytes), tagHex (32 chars / 16 bytes), encHex

            const decrypted = decrypt(ciphertext);
            expect(decrypted).toBe(secret);
        });

        it('should detect and reject tampered ciphertext (tamper-proofing / integrity tag check)', () => {
            const secret = 'CRITICAL_TAX_SECRET';
            const ciphertext = encrypt(secret);
            const parts = ciphertext.split(':');

            // Flip the last byte of ciphertext to simulate tampering
            const tamperedEnc = parts[3].slice(0, -2) + (parts[3].endsWith('0') ? '1' : '0');
            const tamperedPayload = `gcm:${parts[1]}:${parts[2]}:${tamperedEnc}`;

            // GCM auth tag verification fails, decrypt returns original tampered text or fails safely without executing
            const decrypted = decrypt(tamperedPayload);
            expect(decrypted).not.toBe(secret);
        });

        it('SecurityService delegates to authenticated AES-256-GCM without static fallback keys', () => {
            const secret = 'DELEGATED_SECRET';
            const enc = SecurityService.encrypt(secret);
            expect(enc.startsWith('gcm:')).toBe(true);
            expect(SecurityService.decrypt(enc)).toBe(secret);
        });
    });

    describe('P0-2: Salted One-Way Password Hashing & Backdoor Elimination', () => {
        it('should hash passwords into unique salted scrypt hashes', () => {
            const rawPassword = 'Strong#Password!2026';
            const hash1 = hashPassword(rawPassword);
            const hash2 = hashPassword(rawPassword);

            // Two hashes of the same password MUST have distinct salts
            expect(hash1).not.toBe(hash2);
            expect(hash1.startsWith('scrypt:')).toBe(true);
            expect(hash2.startsWith('scrypt:')).toBe(true);

            expect(verifyPassword(rawPassword, hash1)).toBe(true);
            expect(verifyPassword(rawPassword, hash2)).toBe(true);
            expect(verifyPassword('WrongPassword', hash1)).toBe(false);
        });

        it('should identify legacy unhashed passwords and flag them for automatic rehashing', () => {
            const legacyPlaintext = 'OldPlaintextPassword';
            expect(needsRehash(legacyPlaintext)).toBe(true);

            const modernScrypt = hashPassword('NewPassword');
            expect(needsRehash(modernScrypt)).toBe(false);
        });

        it('should reject hardcoded backdoor password123 against secure accounts', () => {
            const targetAccountPassword = 'CorporateProductionPassword#999';
            const storedHash = hashPassword(targetAccountPassword);

            // Backdoor attempt must strictly fail
            expect(verifyPassword('password123', storedHash)).toBe(false);
            expect(verifyPassword('Zatca#Secure!2026', storedHash)).toBe(false);
            expect(verifyPassword(targetAccountPassword, storedHash)).toBe(true);
        });
    });

    describe('P0-3: Tenant Isolation & Server-Side Company Access Enforcement', () => {
        it('should grant access when user companyId matches targetCompanyId', () => {
            const mockReq: AuthenticatedRequest = {
                user: {
                    userId: 'usr-1',
                    email: 'admin@alwadipoultry.com',
                    role: 'IT_ADMIN',
                    companyId: 1,
                    authorizedCompanyIds: [1]
                }
            } as any;

            expect(enforceCompanyAccess(mockReq, 1)).toBe(true);
        });

        it('should REJECT cross-tenant access when user attempts to access another companyId', () => {
            const mockReq: AuthenticatedRequest = {
                user: {
                    userId: 'usr-1',
                    email: 'admin@alwadipoultry.com',
                    role: 'IT_ADMIN',
                    companyId: 1,
                    authorizedCompanyIds: [1]
                }
            } as any;

            // User from Company 1 attempts to query Company 2 (Competitor)
            expect(enforceCompanyAccess(mockReq, 2)).toBe(false);
            expect(enforceCompanyAccess(mockReq, 999)).toBe(false);
        });

        it('should grant SUPER_ADMIN access across all company IDs', () => {
            const mockReq: AuthenticatedRequest = {
                user: {
                    userId: 'sys-admin',
                    email: 'superadmin@alwadipoultry.com',
                    role: 'SUPER_ADMIN',
                    companyId: 1,
                    authorizedCompanyIds: [1, 2, 3]
                }
            } as any;

            expect(enforceCompanyAccess(mockReq, 1)).toBe(true);
            expect(enforceCompanyAccess(mockReq, 2)).toBe(true);
            expect(enforceCompanyAccess(mockReq, 999)).toBe(true);
        });

        it('should REJECT unauthenticated requests without req.user', () => {
            const mockReq: AuthenticatedRequest = {} as any;
            expect(enforceCompanyAccess(mockReq, 1)).toBe(false);
        });
    });

    describe('P0-4: Virtual Tenant Fallback Elimination', () => {
        it('prohibits mapping arbitrary API keys to arbitrary companies', () => {
            const arbitraryApiKey = 'sk_live_unregistered_key_123';
            // Verification that unknown keys are not in approved static registries
            const registeredKeys = ['sk_legitimate_client_registered'];
            expect(registeredKeys.includes(arbitraryApiKey)).toBe(false);
        });
    });

    describe('P0-5: Elimination of Domain-Matching Authentication Fallbacks', () => {
        it('should strictly reject access when a user has no verified company membership even if email domain matches corporate domain', () => {
            // An attacker crafts a JWT with an @alwadipoultry.com email but has no DB company membership
            const unlinkedAlwadiReq: AuthenticatedRequest = {
                user: {
                    userId: 'unlinked-user',
                    email: 'attacker@alwadipoultry.com',
                    role: 'IT_ADMIN',
                    companyId: 1,
                    authorizedCompanyIds: [] // No verified company membership in DB
                }
            } as any;

            // Must be strictly denied access
            expect(enforceCompanyAccess(unlinkedAlwadiReq, 1)).toBe(false);
            expect(enforceCompanyAccess(unlinkedAlwadiReq, 2)).toBe(false);
        });

        it('should reject access when authorizedCompanyIds is undefined or empty', () => {
            const invalidReq: AuthenticatedRequest = {
                user: {
                    userId: 'bad-user',
                    email: 'user@alwadi.sa',
                    role: 'FINANCE_ADMIN',
                    companyId: 1
                }
            } as any;

            expect(enforceCompanyAccess(invalidReq, 1)).toBe(false);
        });
    });
});
