
import { invoice_status } from '@prisma/client';

export class ZatcaMappingService {
    /**
     * Map string environment to Prisma enum
     */
    static mapEnv(env: string) {
        switch (env?.toLowerCase()) {
            case 'simulation': return 'SIMULATION';
            case 'production': return 'PRODUCTION';
            case 'sandbox':
            default: return 'SANDBOX';
        }
    }

    /**
     * Map DB Status to Frontend Status
     */
    static mapStatusToFrontend(s: string): string {
        switch (s) {
            case 'CLEARED': return 'Cleared';
            case 'REPORTED': return 'Reported';
            case 'FAILED': return 'Failed';
            case 'SUBMITTED': return 'Reported'; // Map submitted to reported for UI
            default: return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }
    }

    /**
     * Map DB Invoice to Frontend Invoice interface
     */
    static mapInvoiceToFrontend(inv: any) {
        return {
            id: inv.id.toString(),
            branchId: inv.branch_id ? inv.branch_id.toString() : (inv.branch?.id ? inv.branch?.id.toString() : `br-${inv.company_id}`),
            branchCode: inv.branch?.code || undefined,
            branchName: inv.branch?.name || undefined,
            uuid: inv.uuid,
            invoiceNumber: inv.invoice_number,
            issueDate: inv.date.toISOString(),
            supplyDate: inv.date.toISOString(),
            invoiceSubtype: inv.type === 'B2B' ? 'Standard' : 'Simplified',
            documentType: 'Invoice',
            totalAmount: Number(inv.total_amount),
            vatAmount: Number(inv.tax_amount),
            taxExclusiveAmount: Number(inv.total_amount) - Number(inv.tax_amount),
            previousInvoiceHash: (() => {
                if (inv.previous_invoice_hash) return inv.previous_invoice_hash;
                if (inv.metadata?.previousInvoiceHash) return inv.metadata.previousInvoiceHash;
                if (inv.metadata?.pih) return inv.metadata.pih;
                if (inv.metadata?.erp_raw?.previousInvoiceHash) return inv.metadata.erp_raw.previousInvoiceHash;
                if (inv.xml_payload) {
                    try {
                        if (inv.xml_payload.startsWith('{')) {
                            const parsed = JSON.parse(inv.xml_payload);
                            if (parsed.previousInvoiceHash) return parsed.previousInvoiceHash;
                        } else if (inv.xml_payload.includes('DigestValue')) {
                            const match = inv.xml_payload.match(/<cbc:DigestValue>([\s\S]*?)<\/cbc:DigestValue>/);
                            if (match && match[1]) return match[1].trim();
                        }
                    } catch (e) {}
                }
                return 'NWZlY2ViNTZmZGNlNTQ4NDVkZmVhM2YwMzhhNDk4YWUxNmU1NDNlM2MxM2NhNDQ4RGNhZmJjMzkyMTBiYzFlZA==';
            })(),
            status: ZatcaMappingService.mapStatusToFrontend(inv.status || 'REPORTED'),
            qrCode: inv.qr_code,
            xmlContent: inv.xml_payload,
            zatcaResponse: (() => {
                if (!inv.submission_response) return null;
                try {
                    return typeof inv.submission_response === 'string'
                        ? JSON.parse(inv.submission_response)
                        : inv.submission_response;
                } catch (e) {
                    console.warn(`[ZATCA API] Failed to parse submission_response for invoice ${inv.id}:`, e);
                    return { status: 'ERROR', message: 'Malformed ZATCA response stored in DB' };
                }
            })(),
            supplier: {
                name: inv.company?.registered_name || 'Unknown Supplier',
                vatNumber: inv.company?.vat_number || 'N/A',
                address: {
                    streetName: inv.company?.street_name || inv.company?.address || '',
                    buildingNumber: inv.company?.building_number || '',
                    citySubdivisionName: inv.company?.city_subdivision || '',
                    cityName: inv.company?.city || '',
                    postalZone: inv.company?.postal_zone || '',
                    countryCode: inv.company?.country || 'SA'
                }
            },
            customer: inv.customer ? {
                name: inv.customer.name,
                vatNumber: inv.customer.vat_number || 'N/A',
                address: {
                    streetName: inv.customer.address || '',
                    cityName: inv.customer.city || '',
                    countryCode: inv.customer.country || 'SA'
                }
            } : {
                name: 'Unknown Customer',
                vatNumber: 'N/A',
                address: { streetName: '', cityName: '', countryCode: 'SA' }
            },
            items: (() => {
                // Priority 1: Direct items in metadata (Portal/Integration)
                if (inv.metadata?.items && Array.isArray(inv.metadata.items)) {
                    return inv.metadata.items;
                }
                
                // Priority 2: V2 Async Payload (invoiceLines)
                if (inv.metadata?.payload?.invoiceLines && Array.isArray(inv.metadata.payload.invoiceLines)) {
                    return inv.metadata.payload.invoiceLines.map((line: any) => ({
                        id: line.id || Math.random().toString(36).substr(2, 9),
                        name: line.itemName || 'Item',
                        quantity: Number(line.quantity || 0),
                        unitPrice: Number(line.unitPrice || 0),
                        discount: Number(line.discountAmount || 0),
                        vatRate: Number(line.taxCategory?.percent || 15),
                        vatAmount: Number(line.taxAmount || 0),
                        subtotal: Number(line.lineExtensionAmount || 0),
                        total: Number(line.lineExtensionAmount || 0) + Number(line.taxAmount || 0),
                        taxCategory: line.taxCategory?.id || 'S'
                    }));
                }

                // Priority 3: Fallback - Extract from XML (Recovery Mode)
                if (inv.xml_payload) {
                    try {
                        const xml = inv.xml_payload.startsWith('PD') // Basic base64 check
                            ? Buffer.from(inv.xml_payload, 'base64').toString('utf-8')
                            : inv.xml_payload;
                        
                        // Simple regex extraction for display recovery
                        const lines: any[] = [];
                        // Match InvoiceLine and optionally a following Price block (fallback for malformed XML)
                        const lineMatches = xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>(?:\s*<cac:Price>([\s\S]*?)<\/cac:Price>)?/g);
                        for (const match of lineMatches) {
                            const content = match[1];
                            const priceContent = match[2];
                            
                            const name = content.match(/<cbc:Name>([\s\S]*?)<\/cbc:Name>/)?.[1] || 'Item';
                            const qty = content.match(/<cbc:InvoicedQuantity[^>]*>([\s\S]*?)<\/cbc:InvoicedQuantity>/)?.[1] || '0';
                            
                            // Check for PriceAmount inside the line, or in the fallback price block
                            const priceInside = content.match(/<cbc:PriceAmount[^>]*>([\s\S]*?)<\/cbc:PriceAmount>/)?.[1];
                            const priceOutside = priceContent?.match(/<cbc:PriceAmount[^>]*>([\s\S]*?)<\/cbc:PriceAmount>/)?.[1];
                            const price = priceInside || priceOutside || '0';

                            const subtotal = content.match(/<cbc:LineExtensionAmount[^>]*>([\s\S]*?)<\/cbc:LineExtensionAmount>/)?.[1] || '0';
                            const tax = content.match(/<cbc:TaxAmount[^>]*>([\s\S]*?)<\/cbc:TaxAmount>/)?.[1] || '0';
                            const taxCat = content.match(/<cac:ClassifiedTaxCategory>[\s\S]*?<cbc:ID>([\s\S]*?)<\/cbc:ID>/)?.[1] || 'S';

                            lines.push({
                                name: name.trim(),
                                quantity: Number(qty),
                                unitPrice: Number(price),
                                subtotal: Number(subtotal),
                                vatAmount: Number(tax),
                                total: Number(subtotal) + Number(tax),
                                taxCategory: taxCat
                            });
                        }
                        if (lines.length > 0) return lines;
                    } catch (e) {
                        console.warn(`[Recovery] Failed to extract items from XML for invoice ${inv.id}`);
                    }
                }

                return [];
            })(),
            history: ZatcaMappingService.buildInvoiceHistory(inv), 
            currencyCode: 'SAR'
        };
    }

    /**
     * Build Invoice Lifecycle Audit Trail from Invoice DB record
     */
    static buildInvoiceHistory(inv: any) {
        const metadata = typeof inv.metadata === 'object' && inv.metadata !== null ? inv.metadata : {};
        
        if (Array.isArray(metadata.history) && metadata.history.length > 0) {
            return metadata.history;
        }

        const createdTime = inv.created_at ? new Date(inv.created_at) : (inv.date ? new Date(inv.date) : new Date());
        const history: any[] = [];

        // 1. Created Event
        history.push({
            step: 'Created',
            timestamp: createdTime.toISOString(),
            user: metadata.user || metadata.client_id || 'ERP Integration',
            details: 'Invoice created & ingested into ZATCA Connect',
            status: 'Success'
        });

        // 2. Signed Event
        const isSigned = !!(inv.hash || inv.signed_xml || inv.xml_payload || inv.status === 'CLEARED' || inv.status === 'REPORTED');
        if (isSigned) {
            const signedTime = metadata.signed_at 
                ? new Date(metadata.signed_at) 
                : new Date(createdTime.getTime() + (metadata.sign_duration_ms || 120));
            
            history.push({
                step: 'Signed',
                timestamp: signedTime.toISOString(),
                user: 'ZATCA Cryptographic Stamping Engine',
                details: inv.hash ? `XML signed & SHA-256 digest generated (${inv.hash.substring(0, 10)}...)` : 'XML signed & ECDSA stamped',
                status: 'Success'
            });
        }

        // 3. Final ZATCA Portal Status Event (Cleared / Reported / Rejected / Submitted)
        const status = inv.status ? inv.status.toUpperCase() : 'PENDING';
        
        if (status === 'CLEARED') {
            const clearedTime = inv.cleared_at 
                ? new Date(inv.cleared_at) 
                : (metadata.processed_at ? new Date(metadata.processed_at) : new Date(createdTime.getTime() + (metadata.total_duration_ms || 850)));
            
            history.push({
                step: 'Cleared',
                timestamp: clearedTime.toISOString(),
                user: 'ZATCA Production Clearance API',
                details: 'Standard Tax Invoice cleared successfully by ZATCA Production Portal',
                status: 'Success'
            });
        } else if (status === 'REPORTED' || status === 'SUBMITTED') {
            const reportedTime = inv.cleared_at 
                ? new Date(inv.cleared_at) 
                : (metadata.processed_at ? new Date(metadata.processed_at) : new Date(createdTime.getTime() + (metadata.total_duration_ms || 650)));
            
            history.push({
                step: 'Reported',
                timestamp: reportedTime.toISOString(),
                user: 'ZATCA Production Reporting API',
                details: 'Simplified Tax Invoice reported successfully to ZATCA Production Portal',
                status: 'Success'
            });
        } else if (status === 'FAILED' || status === 'REJECTED') {
            const failedTime = inv.cleared_at 
                ? new Date(inv.cleared_at) 
                : (metadata.processed_at ? new Date(metadata.processed_at) : new Date(createdTime.getTime() + 450));
            
            const errorMsg = inv.error_log 
                || (typeof inv.submission_response === 'string' ? inv.submission_response : JSON.stringify(inv.submission_response)) 
                || 'ZATCA compliance validation failed';

            history.push({
                step: 'Rejected',
                timestamp: failedTime.toISOString(),
                user: 'ZATCA Production Compliance Engine',
                details: typeof errorMsg === 'string' ? errorMsg.substring(0, 150) : 'ZATCA compliance check failed',
                status: 'Failure'
            });
        } else {
            const pendingTime = new Date(createdTime.getTime() + 200);
            history.push({
                step: 'Submitted',
                timestamp: pendingTime.toISOString(),
                user: 'ZATCA Processing Queue',
                details: 'Awaiting response from ZATCA Portal',
                status: 'Pending'
            });
        }

        return history;
    }
}
