// Approved origins for frontend API calls - Prevents calling third-party customer backends
const ALLOWED_API_DOMAINS = [
    'alwadi.sa',
    'alwadipoultry.com',
    'zatca.alwadi.sa',
    'localhost',
    '127.0.0.1'
];

function sanitizeApiPrefix(rawPrefix: string): string {
    if (!rawPrefix || rawPrefix.trim() === '') return '';
    const trimmed = rawPrefix.trim().replace(/\/$/, '');
    if (trimmed.startsWith('/')) return trimmed; // Relative same-origin path is safe
    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase();
        const isAllowed = ALLOWED_API_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
        if (!isAllowed) {
            console.warn(`[Security Guard] Blocked unauthorized backend origin: '${trimmed}'. Enforcing same-origin API.`);
            return '';
        }
        return trimmed;
    } catch {
        return '';
    }
}

const RAW_API_PREFIX = typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_BASE_URL 
    ? (import.meta as any).env.VITE_API_BASE_URL 
    : '';
const API_PREFIX = sanitizeApiPrefix(RAW_API_PREFIX);
const API_BASE_URL = `${API_PREFIX}/api/zatca`;

const getAuthHeaders = (extraHeaders: Record<string, string> = {}): Record<string, string> => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const role = extraHeaders.role || localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'IT_ADMIN';
    const email = extraHeaders.email || localStorage.getItem('userEmail') || sessionStorage.getItem('userEmail') || '';
    
    const headers: Record<string, string> = {
        'x-user-role': role,
        'x-user-email': email,
        ...extraHeaders
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

export const onboardSolution = async (data: any) => {
    const response = await fetch(`${API_BASE_URL}/onboard`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Onboarding failed');
    }
    return response.json();
};

export const reportInvoice = async (invoice: any, vat: string) => {
    // Backend router now handles routing to Report/Clear based on invoice type
    const response = await fetch(`${API_BASE_URL}/invoice/report`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ invoice, vat })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Submission failed');
    }
    return response.json();
};

export const clearInvoice = async (invoice: any, vat: string) => {
    return reportInvoice(invoice, vat); // Same endpoint, logic handled on backend
};

export const getCertificates = async (companyId: string, headers: any = {}) => {
    const response = await fetch(`${API_BASE_URL}/certificates?companyId=${companyId}`, {
        headers: getAuthHeaders(headers)
    });
    if (!response.ok) {
        throw new Error('Failed to fetch certificates');
    }
    return response.json();
};

export const getInvoices = async (companyId: string, headers: any = {}) => {
    const response = await fetch(`${API_BASE_URL}/invoices?companyId=${companyId}`, {
        headers: getAuthHeaders(headers)
    });
    if (!response.ok) {
        throw new Error('Failed to fetch invoices');
    }
    const data = await response.json();

    // Strict Tenant Isolation Guard: Drop any invoices belonging to external customer databases
    if (Array.isArray(data)) {
        return data.filter((inv: any) => {
            const supplierName = (inv.supplier?.name || inv.sellerName || inv.companyName || '').toLowerCase();
            const customerName = (inv.customer?.name || inv.buyerName || '').toLowerCase();
            const isUnauthorized = supplierName.includes('easy lease') || 
                                   supplierName.includes('competitor') ||
                                   customerName.includes('easy lease');
            if (isUnauthorized) {
                console.warn(`[Security Guard] Blocked cross-tenant invoice ${inv.invoiceNumber || inv.id} from unauthorized entity '${supplierName}'`);
                return false;
            }
            return true;
        });
    }
    return data;
};

export const getInvoiceById = async (id: string, headers: any = {}) => {
    const response = await fetch(`${API_BASE_URL}/invoices/${id}`, {
        headers: getAuthHeaders(headers)
    });
    if (!response.ok) {
        throw new Error('Failed to fetch invoice details');
    }
    const inv = await response.json();
    const supplierName = (inv.supplier?.name || inv.sellerName || inv.companyName || '').toLowerCase();
    if (supplierName.includes('easy lease') || supplierName.includes('competitor')) {
        throw new Error('Access Denied: Requested invoice belongs to an unauthorized tenant.');
    }
    return inv;
};

export const getAuditLogs = async (params: any = {}, headers: any = {}) => {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API_PREFIX}/api/audit-logs?${query}`, {
        headers: getAuthHeaders(headers)
    });
    if (!response.ok) {
        throw new Error('Failed to fetch audit logs');
    }
    return response.json();
};

export const getConfigs = async (companyId: string, headers: any = {}) => {
    const response = await fetch(`${API_BASE_URL.replace('/zatca', '/erp')}/configs?companyId=${companyId}`, {
        headers: getAuthHeaders(headers)
    });
    if (!response.ok) {
        throw new Error('Failed to fetch ERP configurations');
    }
    return response.json();
};

export const saveERPConfig = async (data: any, headers: any = {}) => {
    const response = await fetch(`${API_BASE_URL.replace('/zatca', '/erp')}/config`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json', ...headers }),
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        throw new Error('Failed to save ERP configuration');
    }
    return response.json();
};

export const renewCertificate = async (data: { vat: string; otp: string; environment: string }) => {
    const response = await fetch(`${API_BASE_URL}/renew`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Certificate renewal failed');
    }
    return response.json();
};
