
import { Invoice, Certificate, AuditLogEntry, Party, ERPSystem, InvoiceHistoryEvent, DocumentType, Organization } from '../types';
import { validateZatcaInvoice } from './validation';
import { computeSHA256, mockSign, generateZatcaQR } from './crypto';
import { loadFromStorage, saveToStorage, KEYS } from './storage';

// Helper to get future date
const getFutureDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
};

const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// --- INITIAL DATA SEEDING ---

const initialOrganizations: Organization[] = [
  {
    id: 'org-001',
    name: 'Alwadi',
    vatNumber: '300000000000003',
    crNumber: '1010101010',
    branches: [
      {
        id: 'br-001',
        organizationId: 'org-001',
        name: 'Riyadh Main Branch (HQ)',
        type: 'HQ',
        address: {
          streetName: 'King Fahd Road',
          buildingNumber: '7210',
          additionalNumber: '1111',
          citySubdivisionName: 'Olaya',
          cityName: 'Riyadh',
          postalZone: '12211',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-002',
        organizationId: 'org-001',
        name: 'Jeddah Regional Branch',
        type: 'BRANCH',
        address: {
          streetName: 'Al Madinah Road',
          buildingNumber: '3410',
          additionalNumber: '2222',
          citySubdivisionName: 'Al Sharafeyah',
          cityName: 'Jeddah',
          postalZone: '22234',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-003',
        organizationId: 'org-001',
        name: 'Dammam Branch',
        type: 'BRANCH',
        address: {
          streetName: 'King Abdulaziz St',
          buildingNumber: '8912',
          additionalNumber: '3333',
          citySubdivisionName: 'Al Shati',
          cityName: 'Dammam',
          postalZone: '32414',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-004',
        organizationId: 'org-001',
        name: 'Khobar Commercial Branch',
        type: 'BRANCH',
        address: {
          streetName: 'Prince Turki St',
          buildingNumber: '4520',
          additionalNumber: '4444',
          citySubdivisionName: 'Al Yarmouk',
          cityName: 'Al Khobar',
          postalZone: '34423',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-005',
        organizationId: 'org-001',
        name: 'Medina Branch',
        type: 'BRANCH',
        address: {
          streetName: 'Sultana Rd',
          buildingNumber: '6110',
          additionalNumber: '5555',
          citySubdivisionName: 'Al Iskan',
          cityName: 'Medina',
          postalZone: '42311',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-006',
        organizationId: 'org-001',
        name: 'Mecca Branch',
        type: 'BRANCH',
        address: {
          streetName: 'Ibrahim Al Khalil St',
          buildingNumber: '2310',
          additionalNumber: '6666',
          citySubdivisionName: 'Al Misfalah',
          cityName: 'Mecca',
          postalZone: '24231',
          countryCode: 'SA'
        }
      },
      {
        id: 'br-007',
        organizationId: 'org-001',
        name: 'Tabuk Branch',
        type: 'BRANCH',
        address: {
          streetName: 'King Faisal Rd',
          buildingNumber: '4120',
          additionalNumber: '7777',
          citySubdivisionName: 'Al Ulaya',
          cityName: 'Tabuk',
          postalZone: '47911',
          countryCode: 'SA'
        }
      }
    ]
  },
  {
    id: 'org-002',
    name: 'Retail Chain Co.',
    vatNumber: '311111111111113',
    crNumber: '2020202020',
    branches: [
      {
        id: 'br-008',
        organizationId: 'org-002',
        name: 'Dammam Mall Store',
        type: 'Store',
        address: {
          streetName: 'Corniche Rd',
          buildingNumber: '9988',
          additionalNumber: '3333',
          citySubdivisionName: 'Al Shati',
          cityName: 'Dammam',
          postalZone: '32413',
          countryCode: 'SA'
        }
      }
    ]
  }
];

export const defaultSupplier: Party & { organizationId: string } = {
  organizationId: initialOrganizations[0].id,
  name: initialOrganizations[0].branches[0].name,
  vatNumber: initialOrganizations[0].vatNumber,
  crNumber: initialOrganizations[0].crNumber,
  address: initialOrganizations[0].branches[0].address
};

const initialCertificates: Certificate[] = [
  {
    id: 'cert-001',
    branchId: 'br-001',
    commonName: 'CCSID-Production-HQ',
    serialNumber: '5647382910',
    validFrom: '2023-01-01',
    validTo: getFutureDate(365),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-002',
    branchId: 'br-002',
    commonName: 'CCSID-Production-Jeddah',
    serialNumber: '1029384756',
    validFrom: '2023-06-15',
    validTo: getFutureDate(300),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-003',
    branchId: 'br-003',
    commonName: 'CCSID-Production-Dammam',
    serialNumber: '9988776655',
    validFrom: '2023-01-01',
    validTo: getFutureDate(280),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-004',
    branchId: 'br-004',
    commonName: 'CCSID-Production-Khobar',
    serialNumber: '8877665544',
    validFrom: '2023-03-01',
    validTo: getFutureDate(250),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-005',
    branchId: 'br-005',
    commonName: 'CCSID-Production-Medina',
    serialNumber: '7766554433',
    validFrom: '2023-04-10',
    validTo: getFutureDate(220),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-006',
    branchId: 'br-006',
    commonName: 'CCSID-Production-Mecca',
    serialNumber: '6655443322',
    validFrom: '2023-05-12',
    validTo: getFutureDate(200),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  },
  {
    id: 'cert-007',
    branchId: 'br-007',
    commonName: 'CCSID-Production-Tabuk',
    serialNumber: '5544332211',
    validFrom: '2023-07-01',
    validTo: getFutureDate(180),
    status: 'Active',
    type: 'Production',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    hasPrivateKey: true
  }
];

export const complianceChecks = [
    { id: '1', name: 'Standard Invoice', description: 'Signed B2B Invoice (UBL 2.1)' },
    { id: '2', name: 'Standard Credit Note', description: 'Signed B2B Credit Note (UBL 2.1)' },
    { id: '3', name: 'Standard Debit Note', description: 'Signed B2B Debit Note (UBL 2.1)' },
    { id: '4', name: 'Simplified Invoice', description: 'Signed B2C Invoice (UBL 2.1)' },
    { id: '5', name: 'Simplified Credit Note', description: 'Signed B2C Credit Note (UBL 2.1)' },
    { id: '6', name: 'Simplified Debit Note', description: 'Signed B2C Debit Note (UBL 2.1)' }
];

// --- MOCK INVOICE GENERATOR FOR DASHBOARD POPULATION ---

const generateMockInvoices = (count: number): Invoice[] => {
    const customers = [
        { name: 'Alpha Corp', vat: '300000000000003' },
        { name: 'Beta Industries', vat: '310000000000003' },
        { name: 'Gamma Trading', vat: '320000000000003' },
        { name: 'Delta Logistics', vat: '330000000000003' },
        { name: 'Walk-in Customer', vat: '' }
    ];

    const getRandomDate = (daysBack: number) => {
        const date = new Date();
        date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
        date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
        return date.toISOString();
    };

    return Array.from({ length: count }).map((_, i) => {
        const rand = Math.random();
        let daysBack = 14;
        if (rand < 0.3) daysBack = 3;
        else if (rand < 0.7) daysBack = 7;
        
        const date = getRandomDate(daysBack);
        
        const subtype = Math.random() > 0.4 ? 'Standard' : 'Simplified';
        const randStatus = Math.random();
        let status: any = 'Cleared';
        if (subtype === 'Simplified') status = 'Reported';
        
        if (randStatus > 0.85) status = 'Rejected';
        else if (randStatus > 0.95) status = 'Pending';
        else if (randStatus > 0.98) status = 'Failed';

        const customer = customers[Math.floor(Math.random() * customers.length)];
        const baseAmount = subtype === 'Standard' ? Math.floor(Math.random() * 50000) + 1000 : Math.floor(Math.random() * 500) + 10;
        
        const vat = baseAmount * 0.15;
        const total = baseAmount + vat;

        const branchIds = ['br-001', 'br-002', 'br-003', 'br-004', 'br-005', 'br-006', 'br-007'];
        const branchId = branchIds[i % branchIds.length];

        return {
            id: `mock-${i + 100}`,
            branchId: branchId,
            uuid: generateUUID(),
            invoiceNumber: `INV-${new Date().getFullYear()}-${1000 + i}`,
            issueDate: date,
            invoiceSubtype: subtype,
            documentType: 'Invoice',
            currencyCode: 'SAR',
            supplier: defaultSupplier,
            customer: {
                name: customer.name,
                vatNumber: customer.vat,
                crNumber: '1010101010',
                address: {
                    streetName: 'King Road',
                    buildingNumber: '1000',
                    citySubdivisionName: 'District',
                    cityName: 'Riyadh',
                    postalZone: '11111',
                    countryCode: 'SA'
                }
            },
            items: [
                { 
                    id: '1', 
                    name: 'Product Service', 
                    quantity: 1, 
                    unitPrice: baseAmount, 
                    discount: 0, 
                    vatRate: 0.15, 
                    vatAmount: vat, 
                    subtotal: baseAmount, 
                    total: total 
                }
            ],
            totalAmount: total,
            vatAmount: vat,
            taxExclusiveAmount: baseAmount,
            status: status,
            history: [],
            invoiceHash: 'mock_hash_' + i,
            previousInvoiceHash: i > 0 ? 'mock_hash_' + (i - 1) : 'NWZlY2ViNTZmZGNlNTQ4NDVkZmVhM2YwMzhhNDk4YWUxNmU1NDNlM2MxM2NhNDQ4RGNhZmJjMzkyMTBiYzFlZA==',
            signature: status !== 'Pending' && status !== 'Failed' ? 'mock_sig_' + i : undefined,
            qrCode: status !== 'Pending' && status !== 'Failed' ? 'mock_qr' : undefined
        } as Invoice;
    });
};

const staticInvoices: Invoice[] = [
  {
    id: '1',
    branchId: 'br-001',
    uuid: 'a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890',
    invoiceNumber: 'INV-2023-001',
    issueDate: new Date().toISOString(), 
    invoiceSubtype: 'Standard',
    documentType: 'Invoice',
    currencyCode: 'SAR',
    supplier: defaultSupplier,
    customer: {
      name: 'Alpha Corp',
      vatNumber: '310000000000003',
      crNumber: '1010101020',
      address: {
        streetName: 'King Fahd Road',
        buildingNumber: '5678',
        additionalNumber: '2222',
        citySubdivisionName: 'Al Malqa',
        cityName: 'Riyadh',
        postalZone: '11543',
        countryCode: 'SA'
      }
    },
    items: [
      { id: 'i1', name: 'Consulting Services', quantity: 10, unitPrice: 500, discount: 0, vatRate: 0.15, vatAmount: 750, subtotal: 5000, total: 5750 }
    ],
    totalAmount: 5750,
    vatAmount: 750,
    taxExclusiveAmount: 5000,
    status: 'Cleared',
    history: [
      { step: 'Created', timestamp: new Date(Date.now() - 3600000).toISOString(), user: 'System', status: 'Success' },
      { step: 'Validated', timestamp: new Date(Date.now() - 1800000).toISOString(), user: 'ZATCA Core', status: 'Success', details: 'Structure Valid' },
      { step: 'Cleared', timestamp: new Date(Date.now() - 900000).toISOString(), user: 'ZATCA API', status: 'Success', details: 'Cleared with Warnings' }
    ],
    invoiceHash: 'sha256_hash_mock_1',
    previousInvoiceHash: 'NWZlYTY...',
    signature: 'ecdsa_sig_mock_1',
    qrCode: 'AQZBbHdhZGkCDzMwMDAwMDAwMDAwMDAwMwMTMjAyMy0xMC0yNVQxNDozMDowMAQHNTc1MC4wMAUGNzUwLjAwBhJzaGEyNTZfaGFzaF9tb2NrXzEHEGVjZHNhX3NpZ19tb2NrXzEIJ01Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRS4uLg==',
    zatcaResponse: {
        status: 'PASS',
        validationResults: [{ type: 'WARNING', code: 'BR-KSA-01', message: 'Address slightly incomplete' }]
    }
  },
  {
      id: '3',
      branchId: 'br-001',
      uuid: 'c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012',
      invoiceNumber: 'INV-2023-003',
      issueDate: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
      invoiceSubtype: 'Standard',
      documentType: 'Invoice',
      currencyCode: 'SAR',
      supplier: defaultSupplier,
      customer: {
          name: 'Beta LLC',
          vatNumber: '320000000000003',
          crNumber: '1010101030',
          address: {
              streetName: 'Olaya', buildingNumber: '111', citySubdivisionName: '', cityName: 'Riyadh', postalZone: '12211', countryCode: 'SA'
          }
      },
      items: [{ id: 'i3', name: 'Software Lic', quantity: 1, unitPrice: 10000, discount: 0, vatRate: 0.15, vatAmount: 1500, subtotal: 10000, total: 11500 }],
      totalAmount: 11500,
      vatAmount: 1500,
      taxExclusiveAmount: 10000,
      status: 'Rejected',
      history: [
          { step: 'Created', timestamp: new Date(Date.now() - 173000000).toISOString(), user: 'System', status: 'Success' },
          { step: 'Submitted', timestamp: new Date(Date.now() - 172900000).toISOString(), user: 'System', status: 'Success' },
          { step: 'Rejected', timestamp: new Date(Date.now() - 172800000).toISOString(), user: 'ZATCA API', status: 'Failure', details: 'Validation Failed: Address incomplete' }
      ],
      zatcaResponse: {
          status: 'FAIL',
          validationResults: [{ type: 'ERROR', code: 'BR-KSA-09', message: 'Seller Address missing Building Number' }]
      }
  }
];

const initialAuditLogs: AuditLogEntry[] = [
    { id: 'log-1', timestamp: '2023-10-25T14:25:00', action: 'Invoice Created', category: 'Operational', user: 'John Doe', role: 'FINANCE_ADMIN', ipAddress: '192.168.1.50', details: 'Created INV-2023-001', status: 'Success', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    { id: 'log-2', timestamp: '2023-10-25T14:30:05', action: 'CSID Used', category: 'Security', user: 'System', role: 'IT_ADMIN', ipAddress: '10.0.0.1', details: 'Signed INV-2023-001 using cert-001', status: 'Success', hash: 'd41d8cd98f00b204e9800998ecf8427e' },
];

const initialERPs: ERPSystem[] = [
    { id: 'erp-1', name: 'SAP S/4HANA', vendor: 'SAP', environment: 'Production', apiKey: 'sap_prod_8x7d6f5e', status: 'Connected', lastSync: '2023-10-27T10:00:00', linkedCertificateId: 'cert-001' },
];

// --- LOADING STATE FROM STORAGE ---

const rawStoredOrgs = loadFromStorage<Organization[]>(KEYS.ORGANIZATIONS, initialOrganizations);
// Migrate any legacy cached data
export const mockOrganizations: Organization[] = rawStoredOrgs.map(org => {
  if (org.name === 'Satguru Travels Tourism') {
    return { ...org, name: 'Alwadi' };
  }
  return org;
});
if (rawStoredOrgs.some(org => org.name === 'Satguru Travels Tourism')) {
  saveToStorage(KEYS.ORGANIZATIONS, mockOrganizations);
}
export const mockCertificates: Certificate[] = loadFromStorage(KEYS.CERTIFICATES, initialCertificates);
export const mockAuditLogs: AuditLogEntry[] = loadFromStorage(KEYS.AUDIT_LOGS, initialAuditLogs);
export const mockERPs: ERPSystem[] = loadFromStorage(KEYS.ERPS, initialERPs);

// We need to mutate this array in place so components observing it see changes if they re-render, 
// but primarily components should re-fetch.
const storedInvoices = loadFromStorage<Invoice[]>(KEYS.INVOICES, []);
export const mockInvoices: Invoice[] = storedInvoices.length > 0 
    ? storedInvoices 
    : [...staticInvoices, ...generateMockInvoices(50)];

// If we just generated fresh mock data (first run), save it
if (storedInvoices.length === 0) {
    saveToStorage(KEYS.INVOICES, mockInvoices);
}

// Helpers to persist updates
const persistInvoices = () => saveToStorage(KEYS.INVOICES, mockInvoices);
const persistAudit = () => saveToStorage(KEYS.AUDIT_LOGS, mockAuditLogs);

// --- HELPER FUNCTIONS ---

export const getInvoiceById = (id: string): Invoice | undefined => {
    return mockInvoices.find(i => i.id === id);
};

export const generateInvoiceXML = (invoice: Invoice): string => {
  const date = invoice.issueDate.split('T')[0];
  const time = invoice.issueDate.split('T')[1].substring(0, 8);
  const supplyDate = invoice.supplyDate || date;
  
  let typeCode = '388';
  if (invoice.documentType === 'Credit Note') typeCode = '381';
  if (invoice.documentType === 'Debit Note') typeCode = '383';

  const subtypeCode = invoice.invoiceSubtype === 'Standard' ? '0100000' : '0200000';
  const currency = invoice.currencyCode || 'SAR';
  const paymentCode = invoice.paymentMeansCode || '30';

  const renderAddress = (addr: any) => {
    if (!addr) return '';
    return `
    <cac:PostalAddress>
        ${addr.streetName ? `<cbc:StreetName>${addr.streetName}</cbc:StreetName>` : ''}
        ${addr.buildingNumber ? `<cbc:BuildingNumber>${addr.buildingNumber}</cbc:BuildingNumber>` : ''}
        ${addr.additionalNumber ? `<cbc:PlotIdentification>${addr.additionalNumber}</cbc:PlotIdentification>` : ''}
        ${addr.citySubdivisionName ? `<cbc:CitySubdivisionName>${addr.citySubdivisionName}</cbc:CitySubdivisionName>` : ''}
        ${addr.cityName ? `<cbc:CityName>${addr.cityName}</cbc:CityName>` : ''}
        ${addr.postalZone ? `<cbc:PostalZone>${addr.postalZone}</cbc:PostalZone>` : ''}
        <cac:Country>
            <cbc:IdentificationCode>${addr.countryCode || 'SA'}</cbc:IdentificationCode>
        </cac:Country>
    </cac:PostalAddress>`;
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" 
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" 
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" 
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${invoice.invoiceNumber}</cbc:ID>
    <cbc:UUID>${invoice.uuid}</cbc:UUID>
    <cbc:IssueDate>${date}</cbc:IssueDate>
    <cbc:IssueTime>${time}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${subtypeCode}">${typeCode}</cbc:InvoiceTypeCode>
    ${invoice.instructionNote ? `<cbc:Note>${invoice.instructionNote}</cbc:Note>` : ''}
    <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    
    ${invoice.billingReference ? `
    <cac:BillingReference>
       <cac:InvoiceDocumentReference>
          <cbc:ID>${invoice.billingReference}</cbc:ID>
       </cac:InvoiceDocumentReference>
    </cac:BillingReference>` : ''}

    ${invoice.invoiceHash && invoice.signature ? `
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                                <ds:Reference URI="">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${invoice.invoiceHash}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${invoice.signature}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${mockCertificates.find(c => c.id === invoice.signingCertificateId)?.publicKey || '...'}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>` : ''}
    
    ${invoice.qrCode ? `
    <cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${invoice.qrCode}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>` : ''}

    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${invoice.supplier.crNumber}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyName>
                <cbc:Name>${invoice.supplier.name}</cbc:Name>
            </cac:PartyName>
            ${renderAddress(invoice.supplier.address)}
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${invoice.supplier.vatNumber}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingSupplierParty>

    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyName>
                <cbc:Name>${invoice.customer.name}</cbc:Name>
            </cac:PartyName>
            ${renderAddress(invoice.customer.address)}
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${invoice.customer.vatNumber}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingCustomerParty>

    <cac:Delivery>
        <cbc:ActualDeliveryDate>${supplyDate}</cbc:ActualDeliveryDate>
    </cac:Delivery>

    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>${paymentCode}</cbc:PaymentMeansCode>
    </cac:PaymentMeans>

    ${invoice.paymentTerms ? `
    <cac:PaymentTerms>
        <cbc:Note>${invoice.paymentTerms}</cbc:Note>
    </cac:PaymentTerms>` : ''}

    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${currency}">${invoice.taxExclusiveAmount.toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxInclusiveAmount currencyID="${currency}">${invoice.totalAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${currency}">${invoice.totalAmount.toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
</Invoice>`;
};

// Simulate Submission to ZATCA
export const submitInvoiceToZatca = async (invoiceId: string): Promise<Invoice> => {
    return new Promise(async (resolve, reject) => {
        const index = mockInvoices.findIndex(i => i.id === invoiceId);
        if (index === -1) {
            reject(new Error("Invoice not found"));
            return;
        }

        const invoice = mockInvoices[index];
        const timestamp = new Date().toISOString();
        let updatedInvoice = { ...invoice };
        
        // 0. OFFLINE CHECK
        if (!navigator.onLine) {
            // Queue for sync
            updatedInvoice.status = 'Pending Sync';
            updatedInvoice.history.push({
                step: 'Queued',
                timestamp,
                user: 'System',
                status: 'Offline',
                details: 'Internet unavailable. Queued for auto-sync.'
            });
            mockInvoices[index] = updatedInvoice;
            persistInvoices();
            resolve(updatedInvoice);
            return;
        }

        // 1. Validation Logic
        const validation = validateZatcaInvoice(invoice);
        
        if (!validation.isValid) {
            updatedInvoice.status = 'Rejected';
            updatedInvoice.zatcaResponse = {
                status: 'FAIL',
                validationResults: validation.validationResults
            };
            updatedInvoice.history.push({
                step: 'Rejected',
                timestamp,
                user: 'ZATCA API',
                status: 'Failure',
                details: 'Validation Failed: ' + validation.validationResults[0].message
            });
            mockInvoices[index] = updatedInvoice;
            persistInvoices();
            resolve(updatedInvoice);
            return;
        }

        // Get Active Certificate (Mock)
        const activeCert = mockCertificates.find(c => c.status === 'Active' && c.type === 'Production') || mockCertificates[0];
        
        // 2. Hash & Sign (Simulated Local Signing)
        const canonicalXML = generateInvoiceXML(invoice); 
        const hash = await computeSHA256(canonicalXML);
        const signature = await mockSign(hash, activeCert.id);

        updatedInvoice.invoiceHash = hash;
        updatedInvoice.signature = signature;
        updatedInvoice.signingCertificateId = activeCert.id;

        // Previous Hash Logic
        if (index < mockInvoices.length - 1) {
             updatedInvoice.previousInvoiceHash = mockInvoices[index + 1].invoiceHash || '000000000000';
        } else {
             updatedInvoice.previousInvoiceHash = 'NWZlYTY4...'; // Genesis
        }

        // --- PHASE 2 WORKFLOW SPLIT ---

        if (invoice.invoiceSubtype === 'Simplified') {
            // == SIMPLIFIED (B2C) ==
            const qrCode = await generateZatcaQR(updatedInvoice, hash, signature, activeCert.publicKey || 'pub_key');
            updatedInvoice.qrCode = qrCode;

            updatedInvoice.history.push({
                step: 'Signed',
                timestamp: new Date(Date.now() - 500).toISOString(),
                user: 'System',
                status: 'Success',
                details: `Signed locally with ${activeCert.commonName}. QR Generated.`
            });

            await new Promise(r => setTimeout(r, 1500)); 

            updatedInvoice.status = 'Reported';
            updatedInvoice.zatcaResponse = {
                status: 'PASS',
                reportingStatus: 'REPORTED',
                validationResults: validation.validationResults
            };

            updatedInvoice.history.push({
                step: 'Reported',
                timestamp,
                user: 'ZATCA API',
                status: 'Success',
                details: `Successfully Reported to ZATCA`
            });

        } else {
            // == STANDARD (B2B) ==
            updatedInvoice.history.push({
                step: 'Submitted',
                timestamp: new Date().toISOString(),
                user: 'System',
                status: 'Success',
                details: `Sent to ZATCA for Clearance`
            });

            await new Promise(r => setTimeout(r, 2000));

            updatedInvoice.status = 'Cleared';
            updatedInvoice.zatcaResponse = {
                status: 'PASS',
                clearanceStatus: 'CLEARED',
                validationResults: validation.validationResults
            };

            const qrCode = await generateZatcaQR(updatedInvoice, hash, signature, activeCert.publicKey || 'pub_key');
            updatedInvoice.qrCode = qrCode;

            updatedInvoice.history.push({
                step: 'Cleared',
                timestamp,
                user: 'ZATCA API',
                status: 'Success',
                details: `Clearance Received. ZATCA Stamp Applied.`
            });
        }

        mockInvoices[index] = updatedInvoice;
        persistInvoices();
        resolve(updatedInvoice);
    });
};

export const createInternalInvoice = async (invoiceData: Partial<Invoice>): Promise<Invoice> => {
    return new Promise(async (resolve, reject) => {
        // 1. Prepare Invoice Object
        const newId = Date.now().toString(); // Use timestamp for unique ID in storage
        const uuid = crypto.randomUUID();
        const now = new Date();
        const docType = invoiceData.documentType || 'Invoice';
        const prefix = docType === 'Credit Note' ? 'CN-' : docType === 'Debit Note' ? 'DN-' : 'INV-';
        
        // Ensure default structure
        const invoice: Invoice = {
            id: newId,
            branchId: 'br-001', // Default to HQ if not specified
            uuid: uuid,
            invoiceNumber: invoiceData.invoiceNumber || `${prefix}${now.getFullYear()}-${Math.floor(Math.random()*10000)}`,
            invoiceSubtype: invoiceData.invoiceSubtype || 'Standard',
            documentType: docType,
            billingReference: invoiceData.billingReference,
            instructionNote: invoiceData.instructionNote,
            source: 'Portal',
            currencyCode: 'SAR',
            issueDate: now.toISOString(),
            supplyDate: invoiceData.supplyDate || now.toISOString().split('T')[0],
            paymentMeansCode: invoiceData.paymentMeansCode || '30',
            paymentTerms: invoiceData.paymentTerms,
            supplier: defaultSupplier,
            customer: invoiceData.customer!,
            items: invoiceData.items || [],
            totalAmount: invoiceData.totalAmount || 0,
            taxExclusiveAmount: invoiceData.taxExclusiveAmount || 0,
            vatAmount: invoiceData.vatAmount || 0,
            status: 'Pending',
            history: [
                {
                    step: 'Created',
                    timestamp: now.toISOString(),
                    user: 'Portal User',
                    status: 'Success',
                    details: 'Generated via Internal Portal'
                }
            ]
        };

        // 2. Save to Storage Immediately
        mockInvoices.unshift(invoice);
        persistInvoices();

        // 3. Trigger Submission (Validation -> Signing -> Reporting/Clearance)
        // If offline, submitInvoiceToZatca will handle queueing
        try {
            const processedInvoice = await submitInvoiceToZatca(invoice.id);
            resolve(processedInvoice);
        } catch (error) {
            reject(error);
        }
    });
};

export const submitInvoiceFromERP = async (payload: any): Promise<any> => {
    // Wrapper to simulate ERP submission
    return createInternalInvoice({
        ...payload,
        source: 'ERP'
    });
};

export const syncOfflineData = async (): Promise<number> => {
    if (!navigator.onLine) return 0;

    const pendingInvoices = mockInvoices.filter(i => i.status === 'Pending Sync');
    let syncedCount = 0;

    for (const inv of pendingInvoices) {
        try {
            // Update local history before syncing
            const index = mockInvoices.findIndex(i => i.id === inv.id);
            if(index > -1) {
                mockInvoices[index].history.push({
                    step: 'Synced',
                    timestamp: new Date().toISOString(),
                    user: 'AutoSync',
                    status: 'Success',
                    details: 'Connection restored. Submitting to ZATCA...'
                });
            }
            
            await submitInvoiceToZatca(inv.id);
            syncedCount++;
        } catch (e) {
            console.error("Failed to sync invoice", inv.id, e);
        }
    }
    
    if (syncedCount > 0) persistInvoices();
    return syncedCount;
};
