import * as crypto from 'crypto';
import { encrypt as gcmEncrypt, decrypt as gcmDecrypt } from '../utils/crypto.js';

export class SecurityService {
    /**
     * Encrypts sensitive data using Authenticated AES-256-GCM
     */
    static encrypt(text: string): string {
        return gcmEncrypt(text);
    }

    /**
     * Decrypts sensitive data using Authenticated AES-256-GCM (with CBC migration fallback)
     */
    static decrypt(text: string): string {
        return gcmDecrypt(text);
    }

    /**
     * Generates an HMAC signature for server-to-server auth
     */
    static generateSignature(secret: string, timestamp: string, nonce: string, method: string, path: string, body: any): string {
        const safeSecret = (secret || '').trim();
        const safeTimestamp = (timestamp || '').trim();
        const safeNonce = (nonce || '').trim();
        const safeMethod = (method || '').trim().toUpperCase();
        const safePath = (path || '').trim();

        // Enforce empty bodyHash for GET requests (GET requests do not have bodies in signature calculation)
        const bodyHash = (safeMethod !== 'GET' && body && typeof body === 'object' && Object.keys(body).length > 0)
            ? crypto.createHash('sha256').update(this.stableStringify(body)).digest('hex')
            : '';

        const dataToSign = `${safeTimestamp}${safeNonce}${safeMethod}${safePath}${bodyHash}`;
        return crypto
            .createHmac('sha256', safeSecret)
            .update(dataToSign)
            .digest('hex');
    }

    /**
     * Verifies an HMAC signature for server-to-server auth
     */
    static verifySignature(secret: string, timestamp: string, nonce: string, method: string, path: string, body: any, signature: string): { isValid: boolean, expectedData?: string, expectedSig?: string } {
        try {
            const expectedSignature = this.generateSignature(secret, timestamp, nonce, method, path, body);
            const safeSignature = (signature || '').trim();

            const safeMethod = (method || '').trim().toUpperCase();
            // Enforce empty bodyHash for GET requests
            const bodyHash = (safeMethod !== 'GET' && body && typeof body === 'object' && Object.keys(body).length > 0)
                ? crypto.createHash('sha256').update(this.stableStringify(body)).digest('hex')
                : '';
            const dataToSign = `${(timestamp || '').trim()}${(nonce || '').trim()}${safeMethod}${(path || '').trim()}${bodyHash}`;

            if (!safeSignature) return { isValid: false, expectedData: dataToSign, expectedSig: expectedSignature };

            if (safeSignature.length !== expectedSignature.length) {
                return { isValid: false, expectedData: dataToSign, expectedSig: expectedSignature };
            }

            const isValid = crypto.timingSafeEqual(
                Buffer.from(safeSignature),
                Buffer.from(expectedSignature)
            );

            if (isValid) {
                return { 
                    isValid: true, 
                    expectedData: dataToSign, 
                    expectedSig: expectedSignature 
                };
            }

            // --- Fallback for legacy V1 clients ---
            // Legacy clients hashed JSON.stringify(body) even for GET requests or empty objects.
            const legacyBodyHash = crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
            const legacyDataToSign = `${(timestamp || '').trim()}${(nonce || '').trim()}${safeMethod}${(path || '').trim()}${legacyBodyHash}`;
            const legacyExpectedSignature = crypto.createHmac('sha256', secret).update(legacyDataToSign).digest('hex');

            if (safeSignature.length === legacyExpectedSignature.length && 
                crypto.timingSafeEqual(Buffer.from(safeSignature), Buffer.from(legacyExpectedSignature))) {
                return { 
                    isValid: true, 
                    expectedData: legacyDataToSign, 
                    expectedSig: legacyExpectedSignature 
                };
            }

            return { 
                isValid: false, 
                expectedData: dataToSign, 
                expectedSig: expectedSignature 
            };
        } catch (error) {
            return { isValid: false };
        }
    }

    /**
     * Signs a payload for outgoing webhooks
     */
    static signPayload(secret: string, payload: any): string {
        const data = JSON.stringify(payload);
        return crypto.createHmac('sha256', secret).update(data).digest('hex');
    }

    /**
     * Protects a payload by encrypting specific fields
     */
    static protect(obj: any, fields: string[]): any {
        const protectedObj = { ...obj };
        for (const field of fields) {
            if (protectedObj[field]) {
                protectedObj[field] = this.encrypt(protectedObj[field]);
            }
        }
        return protectedObj;
    }

    public static stableStringify(obj: any): string {
        if (obj === null) return 'null';
        if (typeof obj !== 'object') return JSON.stringify(obj);

        if (Array.isArray(obj)) {
            const items: string[] = obj.map(item => this.stableStringify(item));
            return '[' + items.join(',') + ']';
        }

        const keys = Object.keys(obj).sort();
        const pairs = keys.map(key => {
            return JSON.stringify(key) + ':' + this.stableStringify(obj[key]);
        });
        return '{' + pairs.join(',') + '}';
    }
}
