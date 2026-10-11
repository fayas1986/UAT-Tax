import './lib/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import zatcaRouter from './routes/zatca.js';
import erpRouter from './routes/erp.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import itemsRouter from './routes/items.js';
import auditRouter from './routes/audit.js';
import QueueService from './services/queueService.js';
import SyncService from './services/syncService.js';
import reportsRouter from './routes/reports.js';
import prisma from './lib/prisma.js';
import apiV1Router from './routes/api_v1.js';
import KeepAliveService from './services/keepAliveService.js';
import KeyRotationService from './services/keyRotationService.js';

import { swaggerSpec } from './utils/swagger.js';

const app = express();

// Serve the Swagger JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Correlation ID Middleware
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const existingHeader = req.headers['x-correlation-id'] || req.headers['x-request-id'];
    const correlationId = (Array.isArray(existingHeader) ? existingHeader[0] : existingHeader) || `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    (req as any).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
});

// Initialize Background Queue & Sync (Disabled on Vercel and during tests)
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

if (!process.env.VERCEL && !isTestEnv) {
    QueueService.resume().then(() => {
        console.log('[Queue] Background queue resumed successfully');
        SyncService.start(); // RE-ENABLED: Pulling pending invoices from ERP
    }).catch(err => {
        console.error('[Queue] Failed to resume background queue:', err);
    });
    
    // Start API Key Rotation background job
    KeyRotationService.start();
} else if (process.env.VERCEL) {
    console.log('[Server] Running on Vercel: Background Sync Service is inactive.');
}

// Start Database Keep-Alive Heartbeat (Disabled during test execution)
if (!isTestEnv) {
    KeepAliveService.start();
}
// Harden security headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://core.zatca.gov.sa", "https://simulation.zatca.gov.sa", "http://localhost:3001"],
            frameAncestors: [
                "'self'",
                "https://el-uat.sandbox.operations.uae.dynamics.com",
                "https://*.operations.uae.dynamics.com",
                "https://*.operations.dynamics.com",
                "https://*.dynamics.com",
                "https://*.powerapps.com",
                "https://*.sharepoint.com"
            ],
            upgradeInsecureRequests: null,
        },
    },
    frameguard: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));


app.use('/api/zatca', zatcaRouter);
app.use('/api/invoices', zatcaRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/v1', apiV1Router);
app.use('/api/erp', erpRouter);
app.use('/api/admin/reports', reportsRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRouter);
app.use('/api/audit-logs', auditRouter);

app.get('/', (req, res) => {
    res.json({ message: 'ZATCA Fatoora Backend Running' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/db-test', async (req, res) => {
    try {
        const count = await prisma.user.count();
        res.json({ status: 'connected', userCount: count });
    } catch (err: any) {
        console.warn('[DB Test] Initial count check failed, attempting KeepAlive recovery ping...');
        try {
            await KeepAliveService.pingDatabase();
            const count = await prisma.user.count();
            res.json({ status: 'connected_after_recovery', userCount: count });
        } catch (retryErr: any) {
            console.error('DB Test Error after retry:', retryErr);
            res.status(500).json({ 
                error: 'Database connection failed after recovery attempt', 
                message: retryErr.message,
                code: retryErr.code,
                stack: process.env.NODE_ENV === 'development' ? retryErr.stack : undefined
            });
        }
    }
});
 
// 404 JSON Fallback Handler
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        status: 404
    });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const correlationId = (req as any).correlationId || `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    console.error(`[GLOBAL ERROR] [${correlationId}] ${req.method} ${req.originalUrl}`, err);
    
    const status = err.status || err.statusCode || 500;
    const errorCode = err.code || err.errorCode || (status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_SERVER_ERROR');
    const invNum = req.body?.invoiceNumber || req.body?.invoice_number || req.body?.InvoiceNumber || req.body?.FreeTextInvoiceNumber || req.body?.InvoiceId;
    const custAcc = req.body?.customerAccount || req.body?.customer_account || req.body?.CustomerAccount || req.body?.customer?.accountNumber || req.body?.customer?.name;

    res.status(status).json({
        success: false,
        status: 'ERROR',
        errorCode,
        code: errorCode,
        message: err.message || 'Internal Server Error',
        invoiceNumber: invNum || undefined,
        customerAccount: custAcc || undefined,
        correlationId,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        timestamp: new Date().toISOString()
    });
});

// Export app for Vercel serverless functions
export default app;

// Only listen if not running in a test suite or serverless function
if (!isTestEnv && (!process.env.VERCEL || process.env.NODE_ENV === 'development')) {
    app.listen(port as number, '0.0.0.0', () => {
        console.log(`ZATCA Backend listening at http://localhost:${port}`);
    });
}