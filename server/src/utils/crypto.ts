import * as crypto from 'crypto';

const GCM_IV_LENGTH = 12; // Standard recommended IV length for AES-GCM
const CBC_IV_LENGTH = 16; // Legacy IV length

let ephemeralKey: Buffer | null = null;

/**
 * Resolves the 256-bit encryption key securely.
 * Throws a fatal error in production if ENCRYPTION_KEY is missing.
 */
function getEncryptionKey(): Buffer {
    const rawKey = process.env.ENCRYPTION_KEY;

    if (rawKey && rawKey.trim().length >= 32) {
        // Derive exact 32 bytes via SHA-256
        return crypto.createHash('sha256').update(rawKey.trim()).digest();
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            '[SECURITY FATAL] ENCRYPTION_KEY environment variable is mandatory and must be at least 32 characters in production. Aborting to prevent data exposure.'
        );
    }

    // Ephemeral non-static key for test/dev execution (never hardcoded, changes each run)
    if (!ephemeralKey) {
        ephemeralKey = crypto.randomBytes(32);
    }
    return ephemeralKey;
}

/**
 * Authenticated Encryption using AES-256-GCM.
 * Output format: gcm:<ivHex>:<tagHex>:<ciphertextHex>
 */
export const encrypt = (text: string): string => {
    if (!text) return text;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf-8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Authenticated Decryption using AES-256-GCM with backwards-compatible legacy AES-CBC support.
 */
export const decrypt = (text: string): string => {
    try {
        if (!text || typeof text !== 'string') return text;
        const key = getEncryptionKey();

        // 1. Modern Authenticated GCM Format
        if (text.startsWith('gcm:')) {
            const parts = text.split(':');
            if (parts.length !== 4) return text;

            const iv = Buffer.from(parts[1], 'hex');
            const tag = Buffer.from(parts[2], 'hex');
            const encryptedText = Buffer.from(parts[3], 'hex');

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);

            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString('utf-8');
        }

        // 2. Legacy Migration Support: AES-256-CBC (iv:ciphertext)
        if (text.includes(':')) {
            const textParts = text.split(':');
            if (textParts.length === 2) {
                const iv = Buffer.from(textParts[0], 'hex');
                const encryptedText = Buffer.from(textParts[1], 'hex');

                if (iv.length === CBC_IV_LENGTH) {
                    try {
                        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
                        let decrypted = decipher.update(encryptedText);
                        decrypted = Buffer.concat([decrypted, decipher.final()]);
                        const resStr = decrypted.toString('utf-8');
                        if (resStr) return resStr;
                    } catch {
                        // Decryption failed under primary key
                    }
                }
            }
        }

        return text;
    } catch (error) {
        return text;
    }
};
