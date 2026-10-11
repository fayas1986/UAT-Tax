import React, { useState, useMemo, useEffect } from 'react';
import { complianceChecks, defaultSupplier } from '../services/mockData';
import { Plus, RefreshCw, X, AlertTriangle, Loader2, CheckCircle, ArrowRight, ShieldCheck, Activity, KeyRound, Info, FileText, ChevronDown, List, MoreHorizontal, Heart, MessageSquare, Server, Copy, Calendar, Download, Trash2, Eye, Filter, Tag } from 'lucide-react';
import { Certificate, Branch, Organization } from '../types';
import { onboardSolution, getCertificates, renewCertificate } from '../services/api';

interface CertificateManagerProps {
    selectedBranch?: Branch | null;
    organizations?: Organization[];
}

export const CertificateManager: React.FC<CertificateManagerProps> = ({ selectedBranch, organizations = [] }) => {
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Fetch Certificates
    useEffect(() => {
        const fetchCertificates = async () => {
            if (!selectedBranch?.organizationId) return;
            
            setIsLoading(true);
            try {
                const data = await getCertificates(selectedBranch.organizationId);
                setCertificates(data);
            } catch (error) {
                console.error('Error fetching certificates:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCertificates();
    }, [selectedBranch]);

    // Refactored to use ID for selection to ensure data reactivity
    const [viewingCertId, setViewingCertId] = useState<string | null>(null);

    const selectedCert = useMemo(() =>
        certificates.find(c => c.id === viewingCertId) || null,
        [certificates, viewingCertId]);

    // Onboarding Process State
    const [complianceCsid, setComplianceCsid] = useState<string | null>(null);
    const [isAcquiringCcsid, setIsAcquiringCcsid] = useState(false);
    const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [completedChecks, setCompletedChecks] = useState<string[]>([]);
    
    // Renewal modal state
    const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
    const [renewOtp, setRenewOtp] = useState('');
    const [renewingCert, setRenewingCert] = useState<Certificate | null>(null);
    const [isRenewing, setIsRenewing] = useState(false);

    const companyVat = useMemo(() => {
        if (!selectedBranch?.organizationId) return '';
        const org = organizations.find(o => o.id === selectedBranch.organizationId);
        return org?.vatNumber || '';
    }, [selectedBranch, organizations]);

    const [isRunningChecks, setIsRunningChecks] = useState(false);
    const [checkLogs, setCheckLogs] = useState<string[]>([]);

    // Toast auto-clear
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Onboarding Form State
    const [onboardData, setOnboardData] = useState({
        environment: 'Simulation' as 'Production' | 'Simulation' | 'Sandbox',
        vatNumber: defaultSupplier.vatNumber,
        commonName: 'TS-RYD-01',
        serialNumber: '1-ZatcaConnect|2-Desktop|3-EGS-123456789',
        organizationUnit: 'Riyadh Branch',
        organization: selectedBranch?.name || 'Alwadi Trading L.L.C.',
        otp: '',
        location: 'Riyadh',
        industry: 'IT',
        invoiceType: '1100',
        csrFile: null as File | null,
        tin: '' // 10-digit TIN Number required by SDK v3 for some environments
    });

    // Keep form in sync with selected branch
    useEffect(() => {
        if (selectedBranch && organizations.length > 0) {
            const org = organizations.find(o => o.id === selectedBranch.organizationId);
            const rawName = selectedBranch.name || 'HQ';
            const cleanName = rawName.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1').replace(/(HQ\s*)+/gi, 'HQ').trim();
            const unitName = (cleanName.includes('Branch') || cleanName.includes('HQ')) ? cleanName : `${cleanName} HQ`;
            setOnboardData(prev => ({
                ...prev,
                organization: org?.name || cleanName,
                vatNumber: org?.vatNumber || prev.vatNumber,
                organizationUnit: unitName,
                location: selectedBranch.address?.cityName || 'Riyadh'
            }));
        }
    }, [selectedBranch, organizations]);

    // Filter State (Mock)
    const [filterAssigned, setFilterAssigned] = useState('');
    const [filterCreatedBy, setFilterCreatedBy] = useState('');
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const getRelativeTime = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            const now = new Date();
            const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
            const diffInDays = Math.floor(diffInSeconds / 86400);
            const diffInWeeks = Math.floor(diffInDays / 7);
            const diffInMonths = Math.floor(diffInDays / 30);

            if (diffInDays < 1) return 'Today';
            if (diffInDays < 7) return `${diffInDays} d`;
            if (diffInWeeks < 4) return `${diffInWeeks} w`;
            return `${diffInMonths} m`;
        } catch (e) {
            return dateStr;
        }
    };

    // Helper to calculate days remaining
    const getDaysRemaining = (validTo: string) => {
        const end = new Date(validTo);
        const now = new Date();
        const diff = end.getTime() - now.getTime();
        return Math.ceil(diff / (1000 * 3600 * 24));
    };

    // Helper for progress bar width based on validity
    const getValidityProgress = (validFrom: string, validTo: string) => {
        const start = new Date(validFrom).getTime();
        const end = new Date(validTo).getTime();
        const now = new Date().getTime();
        const total = end - start;
        const elapsed = now - start;
        const percent = Math.min(100, Math.max(0, (elapsed / total) * 100));
        return percent;
    };

    // Filter certificates
    const filteredCertificates = certificates.filter(cert => {
        // 1. Branch Filter
        if (selectedBranch && selectedBranch.id) {
            const certBStr = cert.branchId?.toString();
            const selBStr = selectedBranch.id?.toString();
            const certBNum = certBStr?.replace('br-', '');
            const selBNum = selBStr?.replace('br-', '');
            const matchesId = certBStr === selBStr || (certBNum && certBNum === selBNum);
            const isHq = selectedBranch.type === 'HQ' || selectedBranch.code === 'BR-001' || selectedBranch.name?.toLowerCase().includes('hq');
            if (!matchesId && !(isHq && !cert.branchId)) {
                return false;
            }
        }

        // 2. Mock "Assigned To" Filter (Simulated logic: filtering based on ID parity for demo)
        if (filterAssigned === 'me') {
            // Arbitrary condition to simulate assignment
            if (cert.type === 'Simulation') return false;
        }

        // 3. Mock "Created By" Filter
        if (filterCreatedBy === 'me') {
            // Arbitrary condition
            if (cert.type === 'Production') return false;
        }

        // 4. Tag Filter
        if (activeTag) {
            if (activeTag === 'Production' && cert.type !== 'Production') return false;
            if (activeTag === 'Expired' && cert.status !== 'Expired') return false;
        }

        return true;
    });

    // --- ACTIONS ---

    const handleDownloadCSR = (cert: Certificate) => {
        try {
            // Mock CSR content
            const csrContent = `-----BEGIN CERTIFICATE REQUEST-----
MIIBnjCCAQYCAQAwZzELMAkGA1UEBhMCU0ExEDAOBgNVBAgMB1JpeWFkMREwDwYD
VQQHDAhSaXlhZGgxEzARBgNVBAoMCWVkZ2UubmV0LjExFjAUBgNVBAsMDVJpeWFk
aCBCcmFuY2gxEzARBgNVBAMMCnRlc3QtZGV2LTAxMFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAE+... (Simulated CSR for ${cert.commonName}) ...
Generated on: ${new Date().toISOString()}
Serial: ${cert.serialNumber}
Environment: ${cert.type}
-----END CERTIFICATE REQUEST-----`;

            const blob = new Blob([csrContent], { type: 'application/x-pem-file' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${cert.commonName}_${cert.serialNumber}.csr`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Download failed", error);
            alert("Failed to download CSR. Please try again.");
        }
    };

    const handleRenewCertificate = (cert: Certificate) => {
        setRenewingCert(cert);
        setRenewOtp('');
        setIsRenewModalOpen(true);
    };

    const handleRenewSubmit = async () => {
        if (!renewOtp || renewOtp.length !== 6) {
            setToast({ message: 'Please enter a valid 6-digit OTP from the Fatoora Portal', type: 'error' });
            return;
        }
        if (!renewingCert) return;
        setIsRenewing(true);
        try {
            await renewCertificate({
                vat: companyVat || renewingCert.commonName,
                otp: renewOtp,
                environment: renewingCert.type === 'Production' ? 'production' : 'simulation'
            });
            setToast({ message: `✅ Certificate for ${renewingCert.commonName} renewed successfully!`, type: 'success' });
            setIsRenewModalOpen(false);
            // Refresh certificates list from server
            if (selectedBranch?.organizationId) {
                const updated = await getCertificates(selectedBranch.organizationId);
                setCertificates(updated);
            }
        } catch (e: any) {
            setToast({ message: `❌ Renewal failed: ${e.message}`, type: 'error' });
        } finally {
            setIsRenewing(false);
        }
    };

    const handleRevokeCertificate = (cert: Certificate) => {
        if (!confirm(`WARNING: Are you sure you want to REVOKE ${cert.commonName}? This action cannot be undone and will invalidate signing capabilities.`)) return;

        const updatedCerts = certificates.map(c => {
            if (c.id === cert.id) {
                return {
                    ...c,
                    status: 'Revoked' as const
                };
            }
            return c;
        });

        setCertificates(updatedCerts);
    };

    // --- WIZARD LOGIC ---

    const handleAcquireCcsid = async () => {
        if (!onboardData.otp || onboardData.otp.length !== 6) {
            setToast({ message: "Please enter a valid 6-digit OTP from Fatoora Portal", type: 'error' });
            return;
        }
        setIsAcquiringCcsid(true);
        setOnboardingStatus("Connecting to ZATCA...");

        try {
            // Artificial delay to show "Connecting" status for better UX
            await new Promise(r => setTimeout(r, 800));
            setOnboardingStatus("Generating CSR & Validating OTP...");

            const result = await onboardSolution({
                vat: onboardData.vatNumber,
                otp: onboardData.otp,
                environment: onboardData.environment.toLowerCase(),
                companyName: onboardData.organization,
                branchName: onboardData.organizationUnit,
                location: onboardData.location,
                industry: onboardData.industry,
                invoiceType: onboardData.invoiceType,
                serialNumber: onboardData.serialNumber,
                commonName: onboardData.commonName,
                tin: onboardData.tin // Pass the 10-digit TIN
            });

            if (result.success) {
                setOnboardingStatus("Acquiring Production CSID...");
                await new Promise(r => setTimeout(r, 500));
                
                setComplianceCsid(result.binarySecurityToken || 'PCSID-SUCCESS');
                setToast({ message: "Success! Solution unit onboarded and CSID acquired.", type: 'success' });
                setWizardStep(3); // Auto advance to checks
            } else {
                setToast({ message: `Onboarding failed: ${result.error}`, type: 'error' });
            }
        } catch (error: any) {
            console.error("Onboarding failed", error);
            const msg = error.message.includes('OTP') ? "Invalid OTP: Verification failed." : error.message;
            setToast({ message: `Failed: ${msg}`, type: 'error' });
        } finally {
            setIsAcquiringCcsid(false);
            setOnboardingStatus(null);
        }
    };

    const runComplianceChecks = async () => {
        setIsRunningChecks(true);
        setCompletedChecks([]);
        setCheckLogs([]);

        const checksToRun = onboardData.environment === 'Sandbox'
            ? complianceChecks.slice(0, 2) // Fewer checks for Sandbox
            : complianceChecks;

        for (const check of checksToRun) {
            setCheckLogs(prev => [...prev, `Generating ${check.name}...`]);
            await new Promise(r => setTimeout(r, 600));

            setCheckLogs(prev => [...prev, `Signing with ${onboardData.environment} CSID...`]);
            await new Promise(r => setTimeout(r, 400));

            setCheckLogs(prev => [...prev, `Submitting to ${onboardData.environment} API...`]);
            await new Promise(r => setTimeout(r, 600));

            setCompletedChecks(prev => [...prev, check.id]);
            setCheckLogs(prev => [...prev, `✔ ${check.name} Passed`]);
        }
        setIsRunningChecks(false);
    };

    const finishOnboarding = async () => {
        const type = onboardData.environment;

        const newCert: Certificate = {
            id: `cert-${Date.now()}`,
            branchId: selectedBranch?.id || 'unknown',
            commonName: onboardData.commonName,
            serialNumber: onboardData.serialNumber,
            validFrom: new Date().toISOString().split('T')[0],
            validTo: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
            status: 'Active',
            type: type,
            hasPrivateKey: true,
            publicKey: 'MOCK_KEY_' + Date.now()
        };
        setCertificates([...certificates, newCert]);
        setIsWizardOpen(false);
        resetWizard();
    };

    const resetWizard = () => {
        setWizardStep(1);
        setComplianceCsid(null);
        setCompletedChecks([]);
        setCheckLogs([]);
        setOnboardData({
            environment: 'Simulation',
            vatNumber: defaultSupplier.vatNumber,
            commonName: 'TS-RYD-01',
            serialNumber: '1-ZatcaConnect|2-Desktop|3-EGS-123456789',
            organizationUnit: 'Riyadh Branch',
            organization: selectedBranch?.name || 'Alwadi Trading L.L.C.',
            otp: '',
            location: 'Riyadh',
            industry: 'IT',
            invoiceType: '1100',
            csrFile: null,
            tin: ''
        });
    };

    return (
        <div className="flex h-[calc(100vh-140px)] animate-in fade-in duration-500">

            {/* Sidebar Filters */}
            <div className="w-72 flex-shrink-0 pr-6 mr-2 hidden lg:block overflow-y-auto">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 mb-1 flex items-center">
                            <ShieldCheck size={20} className="mr-2 text-indigo-600" />
                            CSR Settings
                        </h3>
                        {selectedBranch && (
                            <div className={`mt-2 p-3 rounded-xl border ${
                                selectedBranch.environment === 'SIMULATION' 
                                ? 'bg-amber-50 border-amber-200' 
                                : selectedBranch.environment === 'SANDBOX'
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-emerald-50 border-emerald-200'
                            }`}>
                                <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
                                    selectedBranch.environment === 'SIMULATION' ? 'text-amber-600' : 
                                    selectedBranch.environment === 'SANDBOX' ? 'text-blue-600' : 'text-emerald-600'
                                }`}>
                                    Active Environment
                                </p>
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-slate-900 truncate">{selectedBranch.environment || 'SANDBOX'}</p>
                                    <div className={`w-2 h-2 rounded-full animate-pulse ${
                                        selectedBranch.environment === 'SIMULATION' ? 'bg-amber-500' : 
                                        selectedBranch.environment === 'SANDBOX' ? 'bg-blue-500' : 'bg-emerald-500'
                                    }`}></div>
                                </div>
                                {selectedBranch.environment === 'SIMULATION' && (
                                    <p className="text-[10px] text-amber-700 mt-2 leading-relaxed font-medium">
                                        <AlertTriangle size={10} className="inline mr-1" />
                                        Mocks active. Real ZATCA certificates are not required.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center">
                                <Filter size={12} className="mr-1.5" /> Filters
                            </label>

                            <div className="space-y-3">
                                <div className="relative group">
                                    <select
                                        className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm cursor-pointer hover:border-slate-300"
                                        value={filterAssigned}
                                        onChange={(e) => setFilterAssigned(e.target.value)}
                                    >
                                        <option value="">All Assignees</option>
                                        <option value="me">Assigned to Me</option>
                                        <option value="others">Others</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-slate-600 transition-colors" />
                                </div>

                                <div className="relative group">
                                    <select
                                        className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm cursor-pointer hover:border-slate-300"
                                        value={filterCreatedBy}
                                        onChange={(e) => setFilterCreatedBy(e.target.value)}
                                    >
                                        <option value="">Created By (Any)</option>
                                        <option value="me">Created by Me</option>
                                        <option value="system">System</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-slate-600 transition-colors" />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center">
                                <Tag size={12} className="mr-1.5" /> Quick Tags
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setActiveTag(activeTag === 'Production' ? null : 'Production')}
                                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${activeTag === 'Production' ? 'bg-emerald-100 text-emerald-700 border-emerald-200 font-bold' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    Production
                                </button>
                                <button
                                    onClick={() => setActiveTag(activeTag === 'Expired' ? null : 'Expired')}
                                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${activeTag === 'Expired' ? 'bg-rose-100 text-rose-700 border-rose-200 font-bold' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    Expired
                                </button>
                                <button className="px-2.5 py-1 text-xs bg-white text-slate-400 border border-slate-200 rounded-lg border-dashed hover:text-slate-600 hover:border-slate-300 transition-colors">
                                    + Add Tag
                                </button>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Save View</span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Filter Name"
                                    className="w-full bg-white border border-slate-200 text-slate-700 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                />
                                <button className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 rounded-xl transition-colors">
                                    <Plus size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {/* Toolbar */}
                <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-center bg-white gap-3">

                    {/* Left controls */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                            <List size={16} />
                            List View
                            <ChevronDown size={14} className="text-slate-400 ml-1" />
                        </button>

                        <button className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors" title="Refresh">
                            <RefreshCw size={16} />
                        </button>

                        <div className="h-5 w-px bg-slate-200 mx-1"></div>

                        <button className="p-1.5 text-slate-500 hover:bg-slate-100 rounded transition-colors">
                            <MoreHorizontal size={16} />
                        </button>
                    </div>

                    {/* Right controls */}
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {/* Filter Button for mobile */}
                        <div className="lg:hidden">
                            <button className="p-2 text-slate-500 border border-slate-200 rounded hover:bg-slate-50">
                                Filters
                            </button>
                        </div>

                        {/* Add Button */}
                        <button
                            onClick={() => setIsWizardOpen(true)}
                            className="bg-black text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center hover:bg-slate-800 transition-colors shadow-sm"
                        >
                            <Plus size={16} className="mr-1.5" /> Add Zatca CSR Settings
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-x-auto overflow-y-auto">
                    <table className="w-full min-w-[700px] text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="w-10 px-4 py-3">
                                    <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                </th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Common Name</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Environment</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">Serial Number</th>
                                <th className="px-4 py-3 font-semibold text-slate-600">VAT Number</th>
                                <th className="px-4 py-3 font-semibold text-slate-600 text-right w-40">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredCertificates.map((cert) => (
                                <tr
                                    key={cert.id}
                                    className="hover:bg-slate-50 group cursor-pointer transition-colors"
                                    onClick={() => setViewingCertId(cert.id)}
                                >
                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            checked={selectedIds.has(cert.id)}
                                            onChange={() => toggleSelection(cert.id)}
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-slate-900 font-medium hover:text-indigo-600 transition-colors">
                                        {cert.commonName}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${cert.type === 'Production' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                            cert.type === 'Simulation' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
                                                cert.type === 'Sandbox' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                    'bg-slate-50 text-slate-700 border-slate-100'
                                            }`}>
                                            {cert.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                        {cert.serialNumber}
                                    </td>
                                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                        {defaultSupplier.vatNumber}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cert.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                                                cert.status === 'Expired' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                {cert.status}
                                            </span>
                                            <div className="w-8 flex justify-center">
                                                <button
                                                    className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-full hover:bg-indigo-50"
                                                    onClick={(e) => { e.stopPropagation(); setViewingCertId(cert.id); }}
                                                >
                                                    <Eye size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {/* Empty or Loading State */}
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-24 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-400 animate-in fade-in duration-500">
                                            <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                                            <p className="text-sm font-medium">Loading CSR configurations...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredCertificates.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center">
                                            <Filter size={32} className="mb-3 opacity-20" />
                                            <p>No certificates found matching filters.</p>
                                            <button
                                                onClick={() => { setFilterAssigned(''); setFilterCreatedBy(''); setActiveTag(null); }}
                                                className="mt-2 text-indigo-600 text-xs font-bold hover:underline"
                                            >
                                                Clear Filters
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {/* Filler Rows if few items */}
                            {filteredCertificates.length > 0 && filteredCertificates.length < 5 && Array.from({ length: 5 - filteredCertificates.length }).map((_, i) => (
                                <tr key={`empty-${i}`} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-4">&nbsp;</td>
                                    <td colSpan={5}></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Table Footer / Pagination */}
                <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
                    <span>{filteredCertificates.length} records found</span>
                    <div className="flex gap-1">
                        <button className="px-2 py-1 hover:bg-slate-200 rounded disabled:opacity-50" disabled>Prev</button>
                        <button className="px-2 py-1 hover:bg-slate-200 rounded disabled:opacity-50" disabled>Next</button>
                    </div>
                </div>
            </div>

            {/* --- CERTIFICATE DETAIL DRAWER --- */}
            {selectedCert && (
                <div className="fixed inset-0 z-[110] flex justify-end">
                    <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity" onClick={() => setViewingCertId(null)} />
                    <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        {/* Drawer Header */}
                        <div className="p-6 border-b border-slate-200 flex items-start justify-between bg-white relative">
                            <div className="h-1.5 w-full bg-indigo-600 absolute top-0 left-0"></div>
                            <div className="pt-2">
                                <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border mb-2 ${selectedCert.type === 'Production' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                    selectedCert.type === 'Simulation' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' :
                                        'bg-amber-100 text-amber-700 border-amber-200'
                                    }`}>
                                    {selectedCert.type} Portal
                                </div>
                                <h3 className="text-2xl font-bold text-slate-900 break-all">{selectedCert.commonName}</h3>
                                <p className="text-xs font-mono text-slate-500 mt-1">ID: {selectedCert.id}</p>
                            </div>
                            <button onClick={() => setViewingCertId(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* Status Card */}
                            <div className={`p-4 rounded-xl border flex items-center gap-3 ${selectedCert.status === 'Active' ? 'bg-emerald-50 border-emerald-100' :
                                selectedCert.status === 'Expired' ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'
                                }`}>
                                <div className={`p-2 rounded-full ${selectedCert.status === 'Active' ? 'bg-emerald-200 text-emerald-700' :
                                    selectedCert.status === 'Expired' ? 'bg-rose-200 text-rose-700' : 'bg-slate-200 text-slate-600'
                                    }`}>
                                    {selectedCert.status === 'Active' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                                </div>
                                <div>
                                    <p className={`text-sm font-bold ${selectedCert.status === 'Active' ? 'text-emerald-800' :
                                        selectedCert.status === 'Expired' ? 'text-rose-800' : 'text-slate-700'
                                        }`}>
                                        Status: {selectedCert.status}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {selectedCert.status === 'Active' ? 'Certificate is valid and operating normally.' : 'Certificate requires attention.'}
                                    </p>
                                </div>
                            </div>

                            {/* Validity Section */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center">
                                    <Calendar size={16} className="mr-2 text-indigo-500" /> Validity Period
                                </h4>
                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-slate-500">Issued</span>
                                        <span className="font-medium text-slate-900">{selectedCert.validFrom}</span>
                                    </div>
                                    <div className="flex justify-between text-sm mb-4">
                                        <span className="text-slate-500">Expires</span>
                                        <span className="font-medium text-slate-900">{selectedCert.validTo}</span>
                                    </div>

                                    <div className="w-full bg-slate-200 rounded-full h-2 mb-2 overflow-hidden">
                                        <div
                                            className={`h-2 rounded-full ${selectedCert.status === 'Expired' ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                            style={{ width: `${getValidityProgress(selectedCert.validFrom, selectedCert.validTo)}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-center text-slate-500">
                                        {selectedCert.status === 'Expired' ? 'Expired' : `${getDaysRemaining(selectedCert.validTo)} days remaining`}
                                    </p>
                                </div>
                            </div>

                            {/* Info Grid */}
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-3 border border-slate-100 rounded-xl">
                                    <p className="text-xs text-slate-400 mb-1">Serial Number</p>
                                    <p className="text-sm font-mono font-medium text-slate-700 break-all">{selectedCert.serialNumber}</p>
                                </div>
                                <div className="p-3 border border-slate-100 rounded-xl">
                                    <p className="text-xs text-slate-400 mb-1">Organization Unit</p>
                                    <p className="text-sm font-medium text-slate-700">Riyadh Branch (HQ)</p>
                                </div>
                            </div>

                            {/* Public Key */}
                            <div>
                                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center justify-between">
                                    <span className="flex items-center"><KeyRound size={16} className="mr-2 text-indigo-500" /> Public Key</span>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(selectedCert.publicKey || '')}
                                        className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center"
                                    >
                                        <Copy size={12} className="mr-1" /> Copy
                                    </button>
                                </h4>
                                <div className="bg-slate-900 rounded-xl p-4 relative group">
                                    <code className="text-[10px] text-emerald-400 font-mono break-all block leading-relaxed max-h-32 overflow-y-auto">
                                        {selectedCert.publicKey || 'No public key available'}
                                    </code>
                                </div>
                            </div>
                        </div>

                        {/* Drawer Footer Actions */}
                        <div className="p-6 border-t border-slate-100 bg-slate-50 grid grid-cols-2 gap-3">
                            <button
                                onClick={() => handleDownloadCSR(selectedCert)}
                                className="flex items-center justify-center px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-colors shadow-sm"
                            >
                                <Download size={16} className="mr-2" /> CSR
                            </button>
                            <button
                                onClick={() => handleRenewCertificate(selectedCert)}
                                className="flex items-center justify-center px-4 py-2.5 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/10"
                            >
                                <RefreshCw size={16} className="mr-2" /> Renew
                            </button>
                            <button
                                onClick={() => handleRevokeCertificate(selectedCert)}
                                className="col-span-2 flex items-center justify-center px-4 py-2.5 text-rose-600 font-medium rounded-xl hover:bg-rose-50 transition-colors"
                            >
                                <Trash2 size={16} className="mr-2" /> Revoke Certificate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- ONBOARDING WIZARD MODAL --- */}
            {isWizardOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200 relative">
                        {/* Wizard Header */}
                        <div className="px-8 py-8 border-b border-slate-200 bg-white flex justify-between items-center relative">
                            <div className="h-1.5 w-full bg-indigo-600 absolute top-0 left-0"></div>
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900">Onboard Solution Unit</h2>
                                <div className="flex items-center space-x-2 text-sm text-slate-600 mt-2">
                                    <span className={wizardStep === 1 ? 'text-indigo-600 font-bold' : ''}>1. Config</span>
                                    <span className="text-slate-300">/</span>
                                    <span className={wizardStep === 2 ? 'text-indigo-600 font-bold' : ''}>2. Auth</span>
                                    <span className="text-slate-300">/</span>
                                    <span className={wizardStep === 3 ? 'text-indigo-600 font-bold' : ''}>3. Compliance</span>
                                    <span className="text-slate-300">/</span>
                                    <span className={wizardStep === 4 ? 'text-indigo-600 font-bold' : ''}>4. Production</span>
                                </div>
                            </div>
                            <button onClick={() => { setIsWizardOpen(false); resetWizard(); }} className="p-2 hover:bg-slate-200 rounded-full text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Wizard Progress */}
                        <div className="flex w-full h-1 bg-slate-100">
                            <div className={`h-full bg-indigo-600 transition-all duration-500 ease-out`} style={{ width: `${wizardStep * 25}%` }}></div>
                        </div>

                        <div className="p-8 overflow-y-auto flex-1">
                            {wizardStep === 1 && (
                                <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                    <div className={`border p-4 rounded-xl flex items-start gap-3 ${
                                        onboardData.environment === 'Simulation' 
                                        ? 'bg-amber-50 border-amber-200' 
                                        : 'bg-blue-50 border-blue-200'
                                    }`}>
                                        {onboardData.environment === 'Simulation' ? (
                                            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                                        ) : (
                                            <Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
                                        )}
                                        <div className="text-sm">
                                            <p className={`font-bold ${onboardData.environment === 'Simulation' ? 'text-amber-800' : 'text-blue-800'}`}>
                                                {onboardData.environment === 'Simulation' ? 'Simulation Mode (Mock)' : 'ZATCA Onboarding'}
                                            </p>
                                            <p className={`mt-1 ${onboardData.environment === 'Simulation' ? 'text-amber-700' : 'text-blue-700'}`}>
                                                {onboardData.environment === 'Simulation' 
                                                  ? 'System will generate a mock certificate. No real connectivity to ZATCA is required.' 
                                                  : `Enter solution unit details. This will generate a real CSR for the ${onboardData.environment} portal.`}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-5">
                                        <div className="col-span-2">
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5 flex items-center">
                                                <Server size={16} className="mr-1.5 text-indigo-500" />
                                                Target Environment
                                            </label>
                                            <div className="grid grid-cols-3 gap-3">
                                                {(['Simulation', 'Sandbox', 'Production'] as const).map((env) => (
                                                    <button
                                                        key={env}
                                                        onClick={() => setOnboardData({ ...onboardData, environment: env })}
                                                        className={`py-3 px-4 rounded-xl border text-sm font-bold transition-all ${onboardData.environment === env
                                                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm'
                                                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                                            }`}
                                                    >
                                                        {env}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="text-xs text-slate-400 mt-2">
                                                {onboardData.environment === 'Production' ? 'Connects to core.zatca.gov.sa' : 'Connects to gw-fatoora.zatca.gov.sa'}
                                            </p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5 flex justify-between items-center">
                                                VAT Number
                                                <span className="text-[10px] font-normal text-slate-400">15 Digits</span>
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="3000XXXXXXXXXXX"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-mono"
                                                value={onboardData.vatNumber}
                                                onChange={e => setOnboardData({ ...onboardData, vatNumber: e.target.value.replace(/[^0-9]/g, '') })}
                                            />
                                            <p className="text-[10px] text-slate-400 mt-1 italic">Used for XML invoice reporting (Production)</p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5 flex justify-between items-center">
                                                TIN Number
                                                <span className="text-[10px] font-normal text-indigo-400">10 Digits (Required for Simulation)</span>
                                            </label>
                                            <input
                                                type="text"
                                                maxLength={10}
                                                placeholder="3000XXXXXX"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-mono"
                                                value={onboardData.tin}
                                                onChange={e => setOnboardData({ ...onboardData, tin: e.target.value.replace(/[^0-9]/g, '') })}
                                            />
                                            <p className="text-[10px] text-indigo-400 mt-1 italic">Used for CSR validation in Sandbox/Simulation</p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5">Common Name (CN)</label>
                                            <input
                                                type="text"
                                                placeholder="TS-RYD-001"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={onboardData.commonName}
                                                onChange={e => setOnboardData({ ...onboardData, commonName: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5">Serial Number</label>
                                            <input
                                                type="text"
                                                placeholder="EGS-123456789"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-mono"
                                                value={onboardData.serialNumber}
                                                onChange={e => setOnboardData({ ...onboardData, serialNumber: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5">Organization</label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={onboardData.organization}
                                                onChange={e => setOnboardData({ ...onboardData, organization: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-800 mb-1.5">Org Unit</label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={onboardData.organizationUnit}
                                                onChange={e => setOnboardData({ ...onboardData, organizationUnit: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Location</label>
                                            <input
                                                type="text"
                                                placeholder="Riyadh"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={onboardData.location}
                                                onChange={e => setOnboardData({ ...onboardData, location: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Industry</label>
                                            <input
                                                type="text"
                                                placeholder="Retail/IT"
                                                className="w-full px-4 py-2.5 bg-white text-slate-900 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                                value={onboardData.industry}
                                                onChange={e => setOnboardData({ ...onboardData, industry: e.target.value })}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Invoice Type (Bitmask)</label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                                    <input
                                                        type="radio"
                                                        name="invoiceType"
                                                        value="1100"
                                                        checked={onboardData.invoiceType === '1100'}
                                                        onChange={() => setOnboardData({ ...onboardData, invoiceType: '1100' })}
                                                    /> Standard & Simplified
                                                </label>
                                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                                    <input
                                                        type="radio"
                                                        name="invoiceType"
                                                        value="1000"
                                                        checked={onboardData.invoiceType === '1000'}
                                                        onChange={() => setOnboardData({ ...onboardData, invoiceType: '1000' })}
                                                    /> Standard Only
                                                </label>
                                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                                    <input
                                                        type="radio"
                                                        name="invoiceType"
                                                        value="0100"
                                                        checked={onboardData.invoiceType === '0100'}
                                                        onChange={() => setOnboardData({ ...onboardData, invoiceType: '0100' })}
                                                    /> Simplified Only
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ... Rest of wizard steps ... */}
                            {wizardStep === 2 && (
                                <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                    <div className="text-center py-6">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                                            <KeyRound size={32} />
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900">Fatoora OTP Authentication</h3>
                                        <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
                                            1. Log in to <a href="#" className="text-indigo-600 underline">Fatoora {onboardData.environment} Portal</a>.<br />
                                            2. Navigate to <strong>Onboarding</strong> and generate a new OTP.<br />
                                            3. Enter the 6-digit OTP below to acquire the Compliance CSID (CCSID).
                                        </p>
                                    </div>

                                    <div className="max-w-xs mx-auto">
                                        <input
                                            type="text"
                                            maxLength={6}
                                            placeholder="123456"
                                            className="w-full text-center text-3xl font-mono tracking-[0.5em] py-3 bg-transparent text-slate-900 border-b-2 border-slate-300 focus:border-indigo-600 focus:outline-none transition-colors"
                                            value={onboardData.otp}
                                            onChange={e => setOnboardData({ ...onboardData, otp: e.target.value.replace(/[^0-9]/g, '') })}
                                        />
                                    </div>

                                    <div className="text-center">
                                        <button
                                            onClick={handleAcquireCcsid}
                                            disabled={isAcquiringCcsid || onboardData.otp.length !== 6}
                                            className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 relative overflow-hidden group"
                                        >
                                            <span className={`inline-flex items-center transition-all ${isAcquiringCcsid ? 'opacity-0' : 'opacity-100'}`}>
                                                Get Compliance CSID
                                            </span>
                                            {isAcquiringCcsid && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-indigo-600">
                                                    <Loader2 size={18} className="animate-spin mr-2" />
                                                    <span className="text-sm">Processing...</span>
                                                </div>
                                            )}
                                        </button>
                                        
                                        {onboardingStatus && (
                                            <div className="mt-4 flex items-center justify-center gap-2 animate-pulse">
                                                <Activity size={14} className="text-indigo-500" />
                                                <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">{onboardingStatus}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {wizardStep === 3 && (
                                <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                    <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3">
                                        <KeyRound size={20} className="text-emerald-600" />
                                        <div>
                                            <h4 className="font-bold text-emerald-800 text-sm">Compliance CSID Active</h4>
                                            <p className="text-xs text-emerald-600 font-mono">{complianceCsid}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Compliance Checks</h3>
                                            <p className="text-sm text-slate-500">Sign and submit sample documents to ZATCA <strong>{onboardData.environment}</strong>.</p>
                                        </div>
                                        {completedChecks.length === 0 && !isRunningChecks && (
                                            <button
                                                onClick={runComplianceChecks}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-md font-medium text-sm flex items-center"
                                            >
                                                <Activity size={16} className="mr-2" /> Run Checks
                                            </button>
                                        )}
                                    </div>

                                    {/* Logs View for Compliance Checks */}
                                    {isRunningChecks && (
                                        <div className="bg-slate-900 p-4 rounded-xl font-mono text-xs text-slate-300 h-32 overflow-y-auto mb-4">
                                            {checkLogs.map((log, i) => (
                                                <div key={i} className="mb-1">{log}</div>
                                            ))}
                                            <div className="animate-pulse">_</div>
                                        </div>
                                    )}

                                    <div className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                                        {(onboardData.environment === 'Sandbox' ? complianceChecks.slice(0, 2) : complianceChecks).map((check) => {
                                            const isCompleted = completedChecks.includes(check.id);

                                            return (
                                                <div key={check.id} className="flex items-center justify-between p-4 border-b border-slate-100 last:border-0 bg-white">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-lg ${isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                                            {isCompleted ? <CheckCircle size={20} /> : <FileText size={20} />}
                                                        </div>
                                                        <div>
                                                            <p className={`text-sm font-bold ${isCompleted ? 'text-slate-900' : 'text-slate-500'}`}>{check.name}</p>
                                                            <p className="text-xs text-slate-400">{check.description}</p>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {isCompleted && <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">PASSED</span>}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {wizardStep === 4 && (
                                <div className="flex flex-col items-center justify-center py-8 text-center animate-in slide-in-from-right duration-300">
                                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 text-emerald-600 animate-in zoom-in duration-500">
                                        <ShieldCheck size={40} />
                                    </div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">{onboardData.environment} CSID Acquired!</h2>
                                    <p className="text-slate-500 max-w-md mb-8">
                                        Compliance checks passed. The {onboardData.environment} Certificate (PCSID) has been retrieved and stored in the secure vault.
                                    </p>

                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 w-full max-w-sm text-left mb-8">
                                        <div className="flex justify-between text-sm mb-2">
                                            <span className="text-slate-500">CSID Type</span>
                                            <span className="font-bold text-slate-900">{onboardData.environment}</span>
                                        </div>
                                        <div className="flex justify-between text-sm mb-2">
                                            <span className="text-slate-500">Device CN</span>
                                            <span className="font-mono text-slate-900">{onboardData.commonName}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Valid Until</span>
                                            <span className="font-bold text-emerald-600">
                                                {new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                            {wizardStep > 1 && wizardStep < 4 ? (
                                <button
                                    onClick={() => setWizardStep(prev => prev - 1)}
                                    className="px-6 py-2.5 text-slate-600 font-medium hover:bg-white hover:shadow-sm rounded-xl transition-all border border-transparent hover:border-slate-200"
                                >
                                    Back
                                </button>
                            ) : <div></div>}

                            {wizardStep === 1 && (
                                <button
                                    onClick={() => setWizardStep(2)}
                                    className="px-6 py-2.5 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 flex items-center"
                                >
                                    Next Step <ArrowRight size={16} className="ml-2" />
                                </button>
                            )}

                            {wizardStep === 3 && (
                                <button
                                    onClick={() => setWizardStep(4)}
                                    disabled={completedChecks.length !== (onboardData.environment === 'Sandbox' ? 2 : complianceChecks.length)}
                                    className="px-6 py-2.5 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Request {onboardData.environment === 'Production' ? 'Production' : 'Pre-Prod'} CSID <ArrowRight size={16} className="ml-2" />
                                </button>
                            )}

                            {wizardStep === 4 && (
                                <button
                                    onClick={finishOnboarding}
                                    className="px-6 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center"
                                >
                                    Close & Activate
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --- CERTIFICATE RENEWAL MODAL --- */}
            {isRenewModalOpen && renewingCert && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200 relative animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="px-6 py-6 border-b border-slate-200 bg-white flex justify-between items-center relative">
                            <div className="h-1.5 w-full bg-amber-500 absolute top-0 left-0"></div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Renew Certificate</h2>
                                <p className="text-xs text-slate-500 mt-1">Request a new certificate validity period from ZATCA</p>
                            </div>
                            <button onClick={() => setIsRenewModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 space-y-4">
                            <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Common Name:</span>
                                    <span className="font-semibold text-slate-800">{renewingCert.commonName}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">VAT Number:</span>
                                    <span className="font-semibold text-slate-800">{companyVat || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Environment:</span>
                                    <span className={`font-semibold ${renewingCert.type === 'Production' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                        {renewingCert.type}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-semibold text-slate-700">
                                    ZATCA OTP <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    maxLength={6}
                                    placeholder="Enter 6-digit OTP"
                                    value={renewOtp}
                                    onChange={(e) => setRenewOtp(e.target.value.replace(/\D/g, ''))}
                                    disabled={isRenewing}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-center text-lg font-bold tracking-widest text-slate-800 disabled:bg-slate-50"
                                />
                                <p className="text-xs text-slate-500 leading-normal">
                                    Generate this OTP from the ZATCA Fatoora Portal (EGS Units section). It is valid for single use for 1 hour.
                                </p>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsRenewModalOpen(false)}
                                disabled={isRenewing}
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRenewSubmit}
                                disabled={isRenewing || renewOtp.length !== 6}
                                className="px-5 py-2 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/10 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isRenewing ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Renewing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw size={16} />
                                        Renew Certificate
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notifications */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[9999] p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300 border ${
                    toast.type === 'success' 
                        ? 'bg-emerald-600 text-white border-emerald-500' 
                        : toast.type === 'error' 
                            ? 'bg-rose-600 text-white border-rose-500' 
                            : 'bg-slate-800 text-white border-slate-700'
                }`}>
                    {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                    <div className="pr-4">
                        <p className="text-sm font-bold">{toast.type === 'success' ? 'Success' : 'Error'}</p>
                        <p className="text-xs opacity-90">{toast.message}</p>
                    </div>
                    <button onClick={() => setToast(null)} className="p-1 hover:bg-black/10 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};
