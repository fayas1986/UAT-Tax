import './env.js';
import { PrismaClient } from '@prisma/client';

export class FatalDatabaseSecurityError extends Error {
  constructor(message: string) {
    super(`[FATAL DATABASE SECURITY GUARD] ${message}`);
    this.name = 'FatalDatabaseSecurityError';
  }
}

/**
 * Approved Test Database Host & Identity Allowlist.
 * In a test environment (NODE_ENV=test or VITEST=true), the database target
 * MUST satisfy positive allowlist rules AND must not match production identifiers.
 */
export const APPROVED_TEST_HOSTS = ['localhost', '127.0.0.1', '::1', 'postgres', 'test-db'];
export const APPROVED_TEST_DB_NAMES = ['test_alwadi_zatca', 'alwadi_zatca_local', 'test_db'];
export const PROD_DISALLOWED_PATTERNS = [
  'neon.tech',
  'neondb',
  'production',
  'prod-db',
  'alwadi_zatca_prod',
  'ep-still-firefly'
];

export function validateDatabaseUrlForEnvironment(rawUrl: string | undefined, isTestEnv: boolean): string {
  if (!rawUrl || rawUrl.trim() === '') {
    throw new FatalDatabaseSecurityError('Database connection URL is missing or empty.');
  }

  const urlString = rawUrl.trim();

  if (isTestEnv) {
    const lowerUrl = urlString.toLowerCase();

    // 1. Blacklist Check: Instant rejection of production patterns regardless of any flags
    for (const pattern of PROD_DISALLOWED_PATTERNS) {
      if (lowerUrl.includes(pattern)) {
        throw new FatalDatabaseSecurityError(
          `Test environment cannot connect to production host or database identifier matching '${pattern}'. Target URL rejected.`
        );
      }
    }

    // 2. Positive Allowlist Check
    let parsedHost = '';
    let parsedDbName = '';

    try {
      const normalized = lowerUrl.startsWith('postgresql://') || lowerUrl.startsWith('postgres://')
        ? lowerUrl
        : `postgresql://${lowerUrl}`;
      const parsed = new URL(normalized);
      parsedHost = parsed.hostname;
      parsedDbName = parsed.pathname.replace(/^\//, '').split('?')[0];
    } catch {
      parsedHost = lowerUrl;
    }

    const isApprovedHost = APPROVED_TEST_HOSTS.some(h => parsedHost.includes(h));
    const isApprovedDb = APPROVED_TEST_DB_NAMES.some(db => parsedDbName === db);

    if (!isApprovedHost && !isApprovedDb) {
      throw new FatalDatabaseSecurityError(
        `Target database URL '${urlString.substring(0, 45)}...' does not match approved test host allowlist [${APPROVED_TEST_HOSTS.join(', ')}] or test DB allowlist [${APPROVED_TEST_DB_NAMES.join(', ')}].`
      );
    }

    return urlString;
  }

  return urlString;
}

const prismaClientSingleton = () => {
  let url = process.env.DATABASE_URL;
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (isTest) {
    let testUrl = process.env.TEST_DATABASE_URL;

    if (!testUrl && process.env.DATABASE_URL) {
      const dbUrlLower = process.env.DATABASE_URL.toLowerCase();
      const isProdDb = PROD_DISALLOWED_PATTERNS.some(p => dbUrlLower.includes(p));
      if (!isProdDb) {
        testUrl = process.env.DATABASE_URL;
      }
    }

    if (!testUrl) {
      console.log('[Prisma Guard] Test environment detected without TEST_DATABASE_URL. Defaulting to local test database...');
      testUrl = 'postgresql://postgres:postgrespassword@localhost:5432/alwadi_zatca_local?sslmode=disable';
    }

    url = validateDatabaseUrlForEnvironment(testUrl, true);
  } else if (!url) {
    console.warn('[Prisma] DATABASE_URL not set in environment. Falling back to Alwadi Neon production pooler connection.');
    url = "postgresql://neondb_owner:npg_4jYTMAbm2NLV@ep-still-firefly-b3vitsw9-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  }

  if (url.includes('neon.tech')) {
    if (!url.includes('-pooler.')) {
      url = url.replace('ep-spring-hat-a18pmkyp.', 'ep-spring-hat-a18pmkyp-pooler.');
    }
    url = url.replace(/&channel_binding=require|\?channel_binding=require&|\?channel_binding=require/g, '');
    if (!url.includes('sslmode=require')) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}sslmode=require`;
    }
  }

  console.log('[Prisma] Initializing with DB URL:', url ? (url.substring(0, 30) + '...') : 'MISSING');

  const basePrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    errorFormat: 'pretty',
    datasourceUrl: url,
  });

  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          try {
            return await query(args);
          } catch (error: any) {
            const errorMsg = error?.message || '';
            const errorCode = error?.code;
            if (
              errorCode === 'P1001' ||
              errorCode === 'P2024' ||
              errorMsg.includes('Connection terminated') ||
              errorMsg.includes('Closed connection') ||
              errorMsg.includes('Can\'t reach database server') ||
              errorMsg.includes('timeout expired') ||
              errorMsg.includes('socket disconnected') ||
              errorMsg.includes('Engine is not yet connected') ||
              errorMsg.includes('connection pool')
            ) {
              console.warn(`[Prisma Retry] Connection error (${errorCode || 'drop'}) on ${model}.${operation}. Reconnecting and retrying...`);
              try {
                await basePrisma.$disconnect();
                await basePrisma.$connect();
                return await query(args);
              } catch (retryError: any) {
                console.error(`[Prisma Retry] Second attempt failed on ${model}.${operation}:`, retryError?.message?.split('\n')[0]);
                throw retryError;
              }
            }
            throw error;
          }
        }
      }
    }
  }) as unknown as PrismaClient;
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = process.env.VERCEL ? prismaClientSingleton() : (globalThis.prisma ?? prismaClientSingleton());

export default prisma;

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) globalThis.prisma = prisma;
