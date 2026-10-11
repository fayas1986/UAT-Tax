
export type InvoiceStatus = 'Cleared' | 'Reported' | 'Rejected' | 'Pending' | 'Failed' | 'Pending Sync' | 'DLQ';

// RBAC Roles
export type UserRole = 'IT_ADMIN' | 'FINANCE_ADMIN' | 'TAX_OFFICER' | 'SUPER_ADMIN';

export type InvoiceSubtype = 'STANDARD' | 'SIMPLIFIED' | 'Standard' | 'Simplified';
export type DocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'Invoice' | 'Credit Note' | 'Debit Note';

export interface Address {
  streetName: string;
  buildingNumber: string;
  additionalNumber?: string; // Critical for ZATCA Phase 2 (National Address)
  citySubdivisionName: string; // District
  cityName: string;
  postalZone: string;
  countryCode: string;
}

export interface Organization {
  id: string;
  name: string;
  vatNumber: string;
  crNumber: string;
  logoUrl?: string;
  branches: Branch[];
  environment?: 'PRODUCTION' | 'SIMULATION' | 'SANDBOX';
}

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  code?: string;
  type: 'HQ' | 'Branch' | 'Store' | 'Warehouse';
  address: Address;
  environment?: 'PRODUCTION' | 'SIMULATION' | 'SANDBOX';
  settings?: any;
}

export interface Party {
  organizationId?: string; // Optional: Link to internal organization
  name: string;
  vatNumber: string; // BT-31
  crNumber: string;  // Commercial Registration
  address: Address;
}

export interface InvoiceItem {
  id: string;
  name: string;
  nameAr?: string;   // Added for Arabic Support
  description?: string; // Added for detailed description
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  subtotal: number; // Excluding VAT
  total: number;    // Including VAT
  taxCategory?: 'S' | 'Z' | 'E' | 'O'; // ZATCA Tax Category Code: S=Standard, Z=Zero, E=Exempt, O=Out of Scope
  taxCategoryCode?: 'S' | 'Z' | 'E' | 'O';
}

export interface Item {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  unitPrice: number;
  unitOfMeasure: string;
  taxCategory: 'S' | 'Z' | 'E' | 'O';
  taxRate: number;
  companyId: string;
}

export interface InvoiceHistoryEvent {
  step: 'Created' | 'Validated' | 'Signed' | 'Submitted' | 'Cleared' | 'Reported' | 'Rejected' | 'Queued' | 'Synced';
  timestamp: string;
  user: string;
  details?: string;
  status: 'Success' | 'Failure' | 'Pending' | 'Offline';
}

export interface Invoice {
  id: string;
  branchId: string; // Link to specific branch
  branchCode?: string;
  branchName?: string;
  uuid: string;
  invoiceNumber: string;
  issueDate: string; // ISO String (Creation Date)
  supplyDate?: string; // ZATCA: Tax Point Date / Actual Delivery Date
  invoiceSubtype: InvoiceSubtype; // Critical for Phase 2 distinction
  documentType: DocumentType; // New: Invoice, Credit Note, or Debit Note
  
  // Credit/Debit Note Specifics
  billingReference?: string; // UUID/ID of the original invoice
  instructionNote?: string; // Reason for Credit/Debit Note

  posTerminalId?: string;
  cashierId?: string;
  
  // ZATCA Payment Means (UN/ECE 4461)
  paymentMeansCode?: '10' | '30' | '42' | '48'; // Cash, Credit Transfer, Bank Account, Card
  paymentTerms?: string; // Textual description
  
  paymentMethod?: 'Cash' | 'Credit Card' | 'Debit Card' | 'Transfer' | 'Other'; // Legacy UI field, mapped to code above
  source?: 'ERP' | 'POS' | 'Portal';
  
  currencyCode: string; // Added to support "Currency" requirement

  // Parties
  supplier: Party;
  customer: Party;

  // Totals
  totalAmount: number; // TaxInclusiveAmount
  vatAmount: number;
  taxExclusiveAmount: number;
  
  items: InvoiceItem[];
  metadata?: {
    items?: InvoiceItem[];
    erp_raw?: any;
  };
  status: InvoiceStatus;
  xmlContent?: string;
  qrCode?: string; // Base64 TLV
  
  // ZATCA specific
  invoiceHash?: string; // SHA-256 Base64
  previousInvoiceHash?: string;
  signature?: string; // Base64 ECDSA Signature
  signingCertificateId?: string; // Reference to the certificate used

  zatcaResponse?: {
    status: string;
    clearanceStatus?: string;
    reportingStatus?: string;
    clearanceId?: string; // Unique ID assigned by ZATCA upon clearance
    validationResults?: Array<{
      type: 'INFO' | 'WARNING' | 'ERROR';
      code: string;
      message: string;
    }>;
  };

  history: InvoiceHistoryEvent[];
}

export interface ComplianceConfig {
  autoArchive: boolean;
  clearanceEnabled: boolean; // Toggle for Standard Invoice Clearance
}

export interface Certificate {
  id: string;
  branchId?: string; // Certificates are usually device/branch specific
  commonName: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  status: 'Active' | 'Expired' | 'Revoked';
  type: 'Production' | 'Simulation' | 'Sandbox' | 'Developer';
  publicKey?: string; // Base64 public key
  hasPrivateKey: boolean; // Tracking if we have the key for signing
}

export interface ERPSystem {
  id: string;
  name: string;
  vendor: 'SAP' | 'Oracle' | 'Microsoft' | 'Salesforce' | 'Custom' | 'POS';
  environment: 'Production' | 'Simulation' | 'Sandbox';
  apiKey: string; // Stored masked or full for demo
  status: 'Connected' | 'Disconnected' | 'Maintenance';
  lastSync: string;
  linkedCertificateId?: string;
  // Custom Integration Config
  sourceUrl?: string;
  authHeader?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  category: 'Security' | 'Operational' | 'Compliance' | 'System';
  user: string;
  role: string;
  ipAddress: string;
  details: string;
  status: 'Success' | 'Failure' | 'Warning';
  resourceId?: string;
  metadata?: Record<string, any>; // For technical details
  hash: string; // SHA-256 of the log entry
}

export interface KPIMetric {
  label: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
}
