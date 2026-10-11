
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';

const router = Router();

// Middleware copied from admin.ts for consistency
const requireSuperAdmin = (req: any, res: any, next: any) => {
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Access Denied: Super Admin only' });
    }
    next();
};

const requireAnyAdmin = (req: any, res: any, next: any) => {
    const userRole = req.headers['x-user-role'];
    const allowedRoles = ['SUPER_ADMIN', 'IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER'];
    if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: 'Access Denied: Unauthorized role' });
    }
    next();
};


const formatKsaValue = (val: any) => {
    if (val === null || val === undefined) return '';
    if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/.test(val))) {
        const dateObj = new Date(val);
        if (!isNaN(dateObj.getTime())) {
            return new Intl.DateTimeFormat('sv-SE', {
                timeZone: 'Asia/Riyadh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).format(dateObj);
        }
    }
    return val;
};

const extractInvoiceItems = (item: any): any[] => {
    if (item.metadata?.items && Array.isArray(item.metadata.items)) {
        return item.metadata.items;
    }
    if (item.metadata?.payload?.invoiceLines && Array.isArray(item.metadata.payload.invoiceLines)) {
        return item.metadata.payload.invoiceLines.map((line: any) => ({
            name: line.itemName || line.name || line.description || 'Item',
            description: line.description || line.itemName || line.name || '',
            quantity: Number(line.quantity || 1),
            unitPrice: Number(line.unitPrice || 0),
            vatAmount: Number(line.taxAmount || 0),
            subtotal: Number(line.lineExtensionAmount || 0),
            total: Number(line.lineExtensionAmount || 0) + Number(line.taxAmount || 0)
        }));
    }
    if (item.xml_payload) {
        try {
            const xml = item.xml_payload.startsWith('PD')
                ? Buffer.from(item.xml_payload, 'base64').toString('utf-8')
                : item.xml_payload;
            const lines: any[] = [];
            const lineMatches = xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g);
            for (const match of lineMatches) {
                const content = match[1];
                const name = content.match(/<cbc:Name>([\s\S]*?)<\/cbc:Name>/)?.[1] || 'Item';
                const qty = content.match(/<cbc:InvoicedQuantity[^>]*>([\s\S]*?)<\/cbc:InvoicedQuantity>/)?.[1] || '1';
                const subtotal = content.match(/<cbc:LineExtensionAmount[^>]*>([\s\S]*?)<\/cbc:LineExtensionAmount>/)?.[1] || '0';
                lines.push({ name: name.trim(), description: name.trim(), quantity: Number(qty), subtotal: Number(subtotal) });
            }
            if (lines.length > 0) return lines;
        } catch (e) {
            // ignore XML extraction errors
        }
    }
    return [];
};

const resolveInvoiceFieldValue = (item: any, key: string): any => {
    const directVal = key.split('.').reduce((obj: any, k: string) => obj?.[k], item);

    switch (key) {
        case 'taxable_amount':
        case 'subtotal':
        case 'tax_exclusive_amount':
        case 'line_extension_amount': {
            if (item.metadata?.taxable_amount !== undefined) return item.metadata.taxable_amount;
            if (item.metadata?.taxExclusiveAmount !== undefined) return item.metadata.taxExclusiveAmount;
            const total = Number(item.total_amount || 0);
            const tax = Number(item.tax_amount || 0);
            return (total - tax).toFixed(2);
        }
        case 'description':
        case 'item_description':
        case 'nature_of_goods':
        case 'items': {
            const items = extractInvoiceItems(item);
            if (items.length > 0) {
                const names = items.map(i => i.name || i.description || i.itemName).filter(Boolean);
                if (names.length > 0) return names.join('; ');
            }
            if (item.metadata?.description) return item.metadata.description;
            if (item.metadata?.note) return item.metadata.note;
            return directVal !== undefined && directVal !== null ? directVal : 'N/A';
        }
        case 'items_summary': {
            const items = extractInvoiceItems(item);
            if (items.length > 0) {
                return items.map(i => `${i.name || i.description || 'Item'} (Qty: ${i.quantity || 1}, Price: ${i.unitPrice || 0}, Taxable: ${i.subtotal || 0}, VAT: ${i.vatAmount || 0})`).join(' | ');
            }
            return 'N/A';
        }
        case 'total_quantity':
        case 'quantity': {
            const items = extractInvoiceItems(item);
            if (items.length > 0) {
                return items.reduce((sum, i) => sum + Number(i.quantity || 1), 0);
            }
            return 1;
        }
        case 'unit_price': {
            const items = extractInvoiceItems(item);
            if (items.length > 0) {
                return items.map(i => i.unitPrice || 0).join(', ');
            }
            return 'N/A';
        }
        case 'vat_rate':
        case 'tax_rate':
        case 'tax_category': {
            const items = extractInvoiceItems(item);
            if (items.length > 0 && items[0].vatRate !== undefined) {
                const rate = items[0].vatRate;
                return `${(rate * (rate <= 1 ? 100 : 1))}%`;
            }
            return item.metadata?.vatRate ? `${item.metadata.vatRate}%` : '15%';
        }
        case 'document_type': {
            return item.metadata?.documentType || item.metadata?.document_type || item.type || 'INVOICE';
        }
        case 'customer.address': {
            return item.customer?.address || item.customer?.street_name || (directVal !== undefined ? directVal : '');
        }
        case 'customer.city': {
            return item.customer?.city || (directVal !== undefined ? directVal : '');
        }
        case 'company.cr_number': {
            return item.company?.cr_number || (directVal !== undefined ? directVal : '');
        }
        case 'company.address': {
            return item.company?.address || item.company?.street_name || (directVal !== undefined ? directVal : '');
        }
        case 'company.city': {
            return item.company?.city || (directVal !== undefined ? directVal : '');
        }
        default:
            return directVal;
    }
};

// POST /api/admin/reports/datapreview - Preview report data without saving
router.post('/datapreview', requireAnyAdmin, async (req, res) => {
    try {
        const { config } = req.body;
        const userRole = req.headers['x-user-role'] as string;
        const userEmail = req.headers['x-user-email'] as string;

        if (!config || !config.columns) {
            return res.status(400).json({ error: 'Config with columns is required' });
        }

        const sourceModel = config.sourceModel || 'invoice';

        // Strict Isolation Logic (same as generate)
        const where: any = {};
        if (userRole !== 'SUPER_ADMIN') {
            const user = await prisma.user.findUnique({ where: { email: userEmail } });
            if (!user) return res.status(403).json({ error: 'User not found for isolation' });

            if (sourceModel === 'invoice') {
                where.company = {
                    OR: [
                        { user_id: user.id },
                        { registered_name: user.company_name || '___NEVER_MATCH___' }
                    ]
                };
            } else if (sourceModel === 'audit_log') {
                where.user = userEmail;
            } else if (sourceModel === 'company') {
                if (user.company_name) {
                    where.OR = [
                        { user_id: user.id },
                        { registered_name: user.company_name }
                    ];
                } else {
                    where.user_id = user.id;
                }
            }
        }

        // Fetch small sample (limit 5)
        let data: any[] = [];
        if (sourceModel === 'invoice') {
            data = await prisma.invoice.findMany({
                where,
                take: 5,
                include: { company: true, customer: true }
            });
        } else if (sourceModel === 'audit_log') {
            data = await prisma.audit_log.findMany({ where, take: 5 });
        } else if (sourceModel === 'company') {
            data = await prisma.company.findMany({
                where,
                take: 5,
                include: { group: true, user: true }
            });
        }

        // Transform data based on mapping
        const mappedData = data.map(item => {
            const row: any = {};
            config.columns.forEach((col: any) => {
                const value = sourceModel === 'invoice'
                    ? resolveInvoiceFieldValue(item, col.key)
                    : col.key.split('.').reduce((obj: any, key: string) => obj?.[key], item);
                row[col.label || col.key] = formatKsaValue(value);
            });
            return row;
        });

        res.json(mappedData);

    } catch (error: any) {
        console.error('[Reports] Preview Error:', error);
        res.status(500).json({ error: 'Failed to preview report', details: error.message });
    }
});

// GET /api/admin/reports/templates - List all templates
router.get('/templates', requireAnyAdmin, async (req, res) => {
    try {
        const templates = await prisma.report_template.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(templates);
    } catch (error) {
        console.error('[Reports] Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// POST /api/admin/reports/templates - Create/Update template (Super Admin only)
router.post('/templates', requireSuperAdmin, async (req, res) => {
    console.log('[Reports] POST /templates received');
    try {
        const { id, name, description, category, config } = req.body;
        console.log('[Reports] Body data:', { id, name });

        if (!name || !config) {
            return res.status(400).json({ error: 'Name and config are required' });
        }

        if (id) {
            const updated = await prisma.report_template.update({
                where: { id: Number(id) },
                data: { name, description, category, config }
            });
            return res.json(updated);
        } else {
            const created = await prisma.report_template.create({
                data: { name, description, category, config }
            });
            return res.json(created);
        }
    } catch (error) {
        console.error('[Reports] Error saving template:', error);
        res.status(500).json({ error: 'Failed to save template' });
    }
});

// DELETE /api/admin/reports/templates/:id
router.delete('/templates/:id', requireSuperAdmin, async (req, res) => {
    try {
        await prisma.report_template.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete template' });
    }
});


// POST /api/admin/reports/generate/:id - Generate report data
router.post('/generate/:id', requireAnyAdmin, async (req, res) => {
    try {
        const templateId = parseInt(req.params.id);
        const { dateRange, format = 'json' } = req.body;
        const userRole = req.headers['x-user-role'];
        const userEmail = req.headers['x-user-email'] as string;

        const template = await prisma.report_template.findUnique({
            where: { id: templateId }
        });

        if (!template) return res.status(404).json({ error: 'Template not found' });

        const config = template.config as any;
        const sourceModel = config.sourceModel || 'invoice'; // Default to invoice

        // Strict Isolation Logic
        const where: any = {};
        if (userRole !== 'SUPER_ADMIN') {
            const user = await prisma.user.findUnique({ where: { email: userEmail } });
            if (!user) return res.status(403).json({ error: 'User not found for isolation' });

            // Map source model to its company/user filter
            if (sourceModel === 'invoice') {
                where.company = {
                    OR: [
                        { user_id: user.id },
                        { registered_name: user.company_name || '___NEVER_MATCH___' }
                    ]
                };
            } else if (sourceModel === 'audit_log') {
                where.user = userEmail; // Audit logs use user email string usually
            } else if (sourceModel === 'company') {
                if (user.company_name) {
                    where.OR = [
                        { user_id: user.id },
                        { registered_name: user.company_name }
                    ];
                } else {
                    where.user_id = user.id;
                }
            }
        }

        // Apply Date Range if provided (KSA timezone UTC+3)
        if (dateRange && dateRange.start && dateRange.end) {
            let startDate: Date;
            if (typeof dateRange.start === 'string' && !dateRange.start.includes('T')) {
                startDate = new Date(`${dateRange.start}T00:00:00.000+03:00`);
            } else {
                startDate = new Date(dateRange.start);
            }

            let endDate: Date;
            if (typeof dateRange.end === 'string' && !dateRange.end.includes('T')) {
                endDate = new Date(`${dateRange.end}T23:59:59.999+03:00`);
            } else {
                endDate = new Date(dateRange.end);
            }

            if (sourceModel === 'invoice') {
                where.AND = where.AND || [];
                where.AND.push({
                    OR: [
                        { created_at: { gte: startDate, lte: endDate } },
                        { date: { gte: startDate, lte: endDate } }
                    ]
                });
            } else {
                where.created_at = {
                    gte: startDate,
                    lte: endDate
                };
            }
        }

        // Fetch Data Dynamically
        let data: any[] = [];
        if (sourceModel === 'invoice') {
            data = await prisma.invoice.findMany({
                where,
                include: {
                    company: true,
                    customer: true
                }
            });
        } else if (sourceModel === 'audit_log') {
            data = await prisma.audit_log.findMany({ where });
        } else if (sourceModel === 'company') {
            data = await prisma.company.findMany({
                where,
                include: {
                    group: true,
                    user: true
                }
            });
        }

        // Transform data based on mapping
        const mappedData = data.map(item => {
            const row: any = {};
            config.columns.forEach((col: any) => {
                // Handle nested paths like company.registered_name & dynamic fields
                const value = sourceModel === 'invoice'
                    ? resolveInvoiceFieldValue(item, col.key)
                    : col.key.split('.').reduce((obj: any, key: string) => obj?.[key], item);
                row[col.label || col.key] = formatKsaValue(value);
            });
            return row;
        });

        if (format === 'csv') {
            if (mappedData.length === 0) return res.send('');
            const headers = Object.keys(mappedData[0]);
            const csvRows = [
                headers.join(','),
                ...mappedData.map(row => headers.map(h => `"${row[h]}"`).join(','))
            ];
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${template.name}.csv"`);
            return res.send(csvRows.join('\n'));
        }

        res.json(mappedData);

    } catch (error: any) {
        console.error('[Reports] Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate report', details: error.message });
    }
});

// GET /api/reports/vat-summary - Tenant-scoped VAT summary report
router.get('/vat-summary', async (req, res) => {
    try {
        const userEmail = (req.headers['x-user-email'] as string)?.trim().toLowerCase();
        const userRole = req.headers['x-user-role'];
        let targetCompanyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : undefined;

        // If not SUPER_ADMIN, strictly scope companyId to user's authorized company
        if (userRole !== 'SUPER_ADMIN' && userEmail) {
            const user = await prisma.user.findFirst({
                where: { email: { equals: userEmail, mode: 'insensitive' } },
                include: { companies: true }
            });
            const authorizedCompany = user?.companies?.[0] || await prisma.company.findFirst({ where: { user_id: user?.id } });
            if (authorizedCompany) {
                targetCompanyId = authorizedCompany.id;
            }
        }

        const where: any = { is_deleted: false };
        if (targetCompanyId) {
            where.company_id = targetCompanyId;
        }

        const invoices = await prisma.invoice.findMany({
            where,
            select: { total_amount: true, tax_amount: true }
        });

        const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
        const totalVat = invoices.reduce((sum, inv) => sum + Number(inv.tax_amount || 0), 0);

        res.json({
            companyId: targetCompanyId,
            invoicesCount: invoices.length,
            totalSales,
            totalVat
        });
    } catch (error: any) {
        console.error('[Reports] VAT Summary Error:', error);
        res.status(500).json({ error: 'Failed to generate VAT summary', details: error.message });
    }
});

export default router;

