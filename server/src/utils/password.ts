import crypto from 'crypto';

const SALT_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 64;

/**
 * Modern salted one-way password hashing using native Node.js scrypt.
 * Format: scrypt:<saltHex>:<hashHex>
 */
export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(SALT_BYTE_LENGTH);
    const derivedKey = crypto.scryptSync(password, salt, KEY_BYTE_LENGTH);
    return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/**
 * Timing-safe password verification supporting modern scrypt and legacy fallback detection.
 */
export function verifyPassword(password: string, storedHash: string, legacyDecryptor?: (text: string) => string): boolean {
    if (!storedHash || !password) return false;

    // 1. Modern scrypt format
    if (storedHash.startsWith('scrypt:')) {
        const parts = storedHash.split(':');
        if (parts.length !== 3) return false;

        const salt = Buffer.from(parts[1], 'hex');
        const expectedHash = Buffer.from(parts[2], 'hex');

        if (salt.length !== SALT_BYTE_LENGTH || expectedHash.length !== KEY_BYTE_LENGTH) {
            return false;
        }

        const actualHash = crypto.scryptSync(password, salt, KEY_BYTE_LENGTH);
        return crypto.timingSafeEqual(expectedHash, actualHash);
    }

    // 2. Legacy Migration Support (One-time check to enable automatic rehashing)
    if (legacyDecryptor && storedHash.includes(':')) {
        try {
            const decrypted = legacyDecryptor(storedHash);
            if (decrypted && decrypted === password) {
                return true;
            }
        } catch {
            // Decryption failed
        }
    }

    // Direct plain text legacy check (for legacy unhashed passwords)
    if (storedHash === password) {
        return true;
    }

    return false;
}

/**
 * Returns true if the password hash is not using the modern scrypt format.
 */
export function needsRehash(storedHash: string): boolean {
    return !storedHash || !storedHash.startsWith('scrypt:');
}
