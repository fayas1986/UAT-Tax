
import { Router } from 'express';
import prisma from '../../lib/prisma.js';
import { ZatcaService, createVerifiedUserContext } from '../../services/zatcaService.js';
import { ZatcaMappingService } from '../../services/zatcaMappingService.js';
import { ResponseHandler } from '../../utils/ResponseHandler.js';

const router = Router();

/**
 * @swagger
 * /api/zatca/invoices:
 *   get:
 *     summary: List all invoices for a company
 *     tags: [ZATCA - Invoices]
 */
router.get('/invoices', async (req, res) => {
    try {
        const rawCompanyId = req.query.companyId as string;
        const rawBranchId = req.query.branchId as string;
        
        let finalCompanyId: number | null = null;
        
        // Handle br- prefix or raw numeric ID in either parameter
        const processId = (id: string | undefined) => {
            if (!id) return null;
            if (id.startsWith('br-')) return parseInt(id.replace('br-', ''));
            const parsed = parseInt(id);
            return isNaN(parsed) ? null : parsed;
        };
        
        finalCompanyId = processId(rawCompanyId) || processId(rawBranchId);
        
        if (!finalCompanyId) return ResponseHandler.badRequest(res, 'companyId or branchId is required');

        const userRole = req.headers['x-user-role'] as string;
        const userEmail = req.headers['x-user-email'] as string;

        const where: any = { company_id: finalCompanyId };

        if (userRole !== 'SUPER_ADMIN' && userEmail && userEmail.trim() !== '' && userEmail !== 'undefined') {
            const user = await prisma.user.findUnique({ where: { email: userEmail } });
            if (user) {
                where.company = {
                    OR: [
                        { user: { email: userEmail } },
                        { registered_name: { equals: user.company_name || '___NEVER_MATCH___', mode: 'insensitive' } }
                    ]
                };
            }
        }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { date: 'desc' },
            include: {
                company: { include: { user: true } },
                customer: true,
                branch: true
            }
        });

        const mappedInvoices = invoices.map(ZatcaMappingService.mapInvoiceToFrontend);
        return ResponseHandler.success(res, mappedInvoices);
    } catch (error: any) {
        console.error('Error fetching invoices:', error);
        return ResponseHandler.error(res, 'Failed to fetch invoices');
    }
});

/**
 * @swagger
 * /api/zatca/invoices/{id}:
 *   get:
 *     summary: Get a specific invoice by ID
 *     tags: [ZATCA - Invoices]
 */
router.get('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const isUuid = id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        
        const userRole = req.headers['x-user-role'];
        const userEmail = req.headers['x-user-email'] as string;

        const where: any = isUuid ? { uuid: id } : { id: parseInt(id) };

        if (userRole !== 'SUPER_ADMIN' && userEmail) {
            const user = await prisma.user.findUnique({ where: { email: userEmail } });
            if (!user) return ResponseHandler.forbidden(res, 'User not found');

            where.company = {
                OR: [
                    { user: { email: userEmail } },
                    { registered_name: { equals: user.company_name || '___NEVER_MATCH___', mode: 'insensitive' } }
                ]
            };
        }

        const invoice = await prisma.invoice.findFirst({
            where,
            include: {
                company: true,
                customer: true
            }
        });

        if (!invoice) return ResponseHandler.notFound(res, 'Invoice not found');

        return ResponseHandler.success(res, ZatcaMappingService.mapInvoiceToFrontend(invoice));
    } catch (error: any) {
        console.error('Error fetching invoice detail:', error);
        return ResponseHandler.error(res, 'Failed to fetch invoice details');
    }
});


/**
 * @swagger
 * /api/zatca/invoice/report:
 *   post:
 *     summary: Report/Clear an invoice with ZATCA
 *     tags: [ZATCA - Invoices]
 */
router.post('/invoice/report', async (req, res) => {
    try {
        const { invoice: invoiceData, companyId, vat, environment } = req.body;
        const userEmail = (req.headers['x-user-email'] as string) || 'portal-user';
        const userRole = (req.headers['x-user-role'] as string) || 'USER';
        const cid = companyId ? parseInt(companyId) : 1;

        const authContext = createVerifiedUserContext(cid, userRole, userEmail);

        const result = await ZatcaService.report({
            invoiceData,
            companyId: cid,
            vat,
            environment: environment || 'PRODUCTION',
            authContext
        });
        
        return ResponseHandler.success(res, result);
    } catch (error: any) {
        console.error('Invoice Reporting Error:', error);
        return ResponseHandler.error(res, error.message);
    }
});


/**
 * @swagger
 * /api/zatca/dlq/reprocess/{invoiceId}:
 *   post:
 *     summary: Reprocess a failed invoice from DLQ
 *     tags: [ZATCA - Invoices]
 */
router.post('/dlq/reprocess/:invoiceId', async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const result = await ZatcaService.reprocessInvoice(parseInt(invoiceId));
        return ResponseHandler.success(res, result);
    } catch (error: any) {
        return ResponseHandler.error(res, error.message);
    }
});

export default router;
