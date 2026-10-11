
import React, { useState, useEffect, useMemo } from 'react';
import { generateInvoiceXML } from '../services/mockData';
import { Search, Filter, Eye, Download, RefreshCw, ChevronLeft, ChevronRight, FileDown, MoreHorizontal, Loader2, ShieldCheck, ShieldAlert, Lock, Tag, FileMinus, FilePlus, FileText, CheckCircle, ChevronDown, ArrowUpRight, Calendar } from 'lucide-react';
import { InvoiceStatus, Invoice, UserRole, Branch } from '../types';
import { useToast } from './Toast';
import { getInvoices } from '../services/api';

interface InvoiceListProps {
  onSelectInvoice: (id: string) => void;
  userRole: UserRole;
  userEmail: string;
  onNavigate?: (route: string, id?: string) => void;
  selectedBranch: Branch | null;
}

export const InvoiceList: React.FC<InvoiceListProps> = ({ onSelectInvoice, userRole, userEmail, onNavigate, selectedBranch }) => {
  const { addToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  
  // Date Filtering State
  const [dateRange, setDateRange] = useState<string>('All Time');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [currentPage, setCurrentPage] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localInvoices, setLocalInvoices] = useState<Invoice[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const itemsPerPage = 8; 

  useEffect(() => {
    if (selectedBranch) {
        fetchInvoices();
        
        // Polling for real-time updates (every 30 seconds)
        const interval = setInterval(() => {
            fetchInvoices();
        }, 30 * 1000);
        
        return () => clearInterval(interval);
    }
  }, [selectedBranch]);

  const fetchInvoices = async () => {
      if (!selectedBranch) return false;
      setIsLoading(true);
      try {
          const orgId = selectedBranch.organizationId || selectedBranch.id;
          console.log(`[InvoiceList] Fetching for OrgID: ${orgId}, BranchID: ${selectedBranch.id}`);
          const data = await getInvoices(orgId.toString(), { role: userRole, email: userEmail });
          console.log(`[InvoiceList] Received ${data.length} invoices from backend.`);
          setLocalInvoices(data);
          return true;
      } catch (error) {
          console.error('Error fetching invoices:', error);
          addToast('error', 'Failed to fetch invoices');
          return false;
      } finally {
          setIsLoading(false);
      }
  };

  // Sync when branch changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBranch]);

  const handleSync = async () => {
    const success = await fetchInvoices();
    if (success) {
        addToast('success', 'Invoices synced successfully');
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Invoice UUID',
      'Issue Date',
      'Supplier Name',
      'Seller VAT Number',
      'Buyer Name',
      'Total Amount',
      'VAT Amount',
      'ZATCA Submission Status'
    ];

    // Filtered invoices are used so the export matches what the user sees
    const filteredToExport = filteredInvoices;

    const rows = filteredToExport.map(inv => [
      inv.uuid,
      new Date(inv.issueDate).toISOString(),
      inv.supplier.name,
      inv.supplier.vatNumber,
      inv.customer.name,
      inv.totalAmount.toFixed(2),
      inv.vatAmount.toFixed(2),
      inv.status
    ].map(field => `"${String(field || '').replace(/"/g, '""')}"`).join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ZATCA_Invoices_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleCreateNote = (invoice: Invoice, e: React.MouseEvent) => {
      e.stopPropagation();
      setActiveMenuId(null);
      if (onNavigate) {
          onNavigate('create-invoice', invoice.id);
      }
  };

  const handleDownloadXML = (invoice: Invoice, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuId(null);
    const xmlContent = invoice.xmlContent || generateInvoiceXML(invoice);
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ZATCA_Invoice_${invoice.invoiceNumber}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filteredInvoices = localInvoices.filter((inv, index) => {
    // Branch Filter (resilient against string/number and `br-` prefix format differences)
    const matchesBranch = (() => {
      if (!selectedBranch) return true;
      const invBranchStr = inv.branchId?.toString();
      const selBranchStr = selectedBranch.id?.toString();
      const invBranchNum = invBranchStr?.replace('br-', '');
      const selBranchNum = selBranchStr?.replace('br-', '');

      // 1. Direct ID or stripped numeric ID match
      if (invBranchStr === selBranchStr || (invBranchNum && invBranchNum === selBranchNum)) {
        return true;
      }

      // 2. Branch Code match if present
      if (inv.branchCode && selectedBranch.code && inv.branchCode.toLowerCase() === selectedBranch.code.toLowerCase()) {
        return true;
      }

      // 3. Fallback for unassigned invoices ONLY if viewing HQ
      const isHq = selectedBranch.type === 'HQ' || selectedBranch.code === 'BR-001' || selectedBranch.code === 'BR-HQ-01' || selectedBranch.name?.toLowerCase().includes('hq');
      if (isHq && (!inv.branchId || inv.branchId === `br-${selectedBranch.organizationId}`)) {
        return true;
      }

      return false;
    })();

    // Search Filter
    const matchesSearch = !searchTerm || 
      (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (inv.customer && inv.customer.name && inv.customer.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (inv.customer && inv.customer.vatNumber && inv.customer.vatNumber.toLowerCase().includes(searchTerm.toLowerCase()));
    
    // Dropdown Filters
    const matchesStatus = statusFilter === 'All' || 
      inv.status === statusFilter || 
      String(inv.status).toUpperCase() === statusFilter.toUpperCase();
    const matchesType = typeFilter === 'All' || inv.invoiceSubtype === typeFilter;

    // Date Range Filter
    let matchesDate = true;
    if (dateRange !== 'All Time') {
        const invDate = new Date(inv.issueDate);
        const now = new Date();
        let startDate = new Date(); // default to now

        if (dateRange === 'Custom') {
            if (customStart) {
                const start = new Date(customStart);
                start.setHours(0,0,0,0);
                if (invDate < start) matchesDate = false;
            }
            if (customEnd) {
                const end = new Date(customEnd);
                end.setHours(23,59,59,999);
                if (invDate > end) matchesDate = false;
            }
        } else {
            // Preset Ranges
            switch (dateRange) {
                case 'Weekly':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'Monthly':
                    startDate.setMonth(now.getMonth() - 1);
                    break;
                case 'Quarterly':
                    startDate.setMonth(now.getMonth() - 3);
                    break;
                case 'Yearly':
                    startDate.setFullYear(now.getFullYear() - 1);
                    break;
            }
            // Set start date to beginning of day for fair comparison? 
            // Usually "Last X days" implies from that timestamp. 
            // But let's zero out the time for cleaner "Inclusive" feeling if comparing to just date part, 
            // though invoices have times. Simple timestamp comparison is usually safest.
            if (invDate < startDate) matchesDate = false;
        }
    }

    const isVisible = matchesBranch && matchesSearch && matchesStatus && matchesType && matchesDate;
    
    if (index === 0 && localInvoices.length > 0) {
        // Log first item only to avoid flooding, but show count and branch info
        console.log(`[InvoiceList] Filtering ${localInvoices.length} invoices for branch ${selectedBranch?.id}. Matches: ${isVisible ? 'YES' : 'NO'} (Branch: ${matchesBranch}, Type: ${matchesType}, Status: ${matchesStatus})`);
    }

    return isVisible;
  }).sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentInvoices = filteredInvoices.slice(startIndex, startIndex + itemsPerPage);

  const showingStart = filteredInvoices.length > 0 ? startIndex + 1 : 0;
  const showingEnd = Math.min(startIndex + itemsPerPage, filteredInvoices.length);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
      
      {/* Toolbar */}
      <div className="p-4 sm:p-6 border-b border-slate-100 bg-white sticky top-0 z-30">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4">
          
          {/* Search */}
          <div className="relative flex-1 max-w-full xl:max-w-md group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search invoices..." 
              className="w-full pl-11 pr-4 py-2.5 sm:py-3 bg-slate-50 hover:bg-slate-50/80 border border-slate-200 rounded-2xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Filters & Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            
            {/* Date Range Filter */}
            <div className="relative flex flex-wrap items-center gap-2">
                <div className="relative min-w-[130px] flex-1 sm:flex-none">
                    <select 
                        className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm cursor-pointer hover:border-slate-300"
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                    >
                        <option value="All Time">All Time</option>
                        <option value="Weekly">Last 7 Days</option>
                        <option value="Monthly">Last 30 Days</option>
                        <option value="Quarterly">Last Quarter</option>
                        <option value="Yearly">Last Year</option>
                        <option value="Custom">Custom</option>
                    </select>
                    <Calendar size={16} className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {/* Custom Date Inputs */}
                {dateRange === 'Custom' && (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <input 
                            type="date" 
                            className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg py-2.5 px-3 focus:outline-none focus:border-indigo-500 shadow-sm flex-1"
                            value={customStart}
                            onChange={(e) => setCustomStart(e.target.value)}
                        />
                        <span className="text-slate-400">-</span>
                        <input 
                            type="date" 
                            className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg py-2.5 px-3 focus:outline-none focus:border-indigo-500 shadow-sm flex-1"
                            value={customEnd}
                            onChange={(e) => setCustomEnd(e.target.value)}
                        />
                    </div>
                )}
            </div>

            <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block"></div>

            {/* Type Filter */}
            <div className="relative min-w-[120px] flex-1 sm:flex-none">
                <select 
                    className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm cursor-pointer hover:border-slate-300"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                >
                    <option value="All">All Types</option>
                    <option value="Standard">Standard</option>
                    <option value="Simplified">Simplified</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Status Filter */}
            <div className="relative min-w-[120px] flex-1 sm:flex-none">
                <select 
                    className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm cursor-pointer hover:border-slate-300"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="All">Status</option>
                    <option value="Cleared">Cleared</option>
                    <option value="Reported">Reported</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Pending">Pending</option>
                    <option value="DLQ">DLQ</option>
                    <option value="Failed">Failed</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            
            <div className="w-px h-8 bg-slate-200 mx-2 hidden sm:block"></div>

            <button 
                onClick={handleExportCSV}
                className="p-2.5 bg-white text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 rounded-xl transition-all shadow-sm hover:shadow active:scale-95 min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Export CSV"
            >
                <FileDown size={20} />
            </button>

            <button 
                onClick={handleSync}
                disabled={isSyncing}
                className={`p-2.5 bg-white text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 rounded-xl transition-all shadow-sm hover:shadow active:scale-95 disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center ${isSyncing ? 'cursor-wait' : ''}`}
                title="Refresh Data"
            >
                <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto bg-slate-50/30">
        <table className="w-full min-w-[750px] text-left text-sm border-collapse">
          <thead className="bg-slate-50/90 backdrop-blur text-xs font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-20 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-bold">Document</th>
              <th className="px-6 py-4 font-bold">Type</th>
              <th className="px-6 py-4 font-bold">Issued</th>
              <th className="px-6 py-4 font-bold">Customer</th>
              <th className="px-6 py-4 font-bold text-right">Amount</th>
              <th className="px-6 py-4 font-bold text-center">Status</th>
              <th className="px-6 py-4 font-bold text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {isLoading ? (
                <tr>
                    <td colSpan={7} className="px-6 py-24 text-center">
                        <div className="flex flex-col items-center justify-center text-slate-400">
                            <Loader2 className="animate-spin mb-4" size={32} />
                            <p className="text-lg font-bold text-slate-700">Loading invoices...</p>
                        </div>
                    </td>
                </tr>
            ) : currentInvoices.length > 0 ? (
                currentInvoices.map((inv) => (
                <tr 
                    key={inv.id} 
                    className="hover:bg-indigo-50/30 transition-all group cursor-pointer relative"
                    onClick={() => onSelectInvoice(inv.id)}
                >
                    <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-xl shadow-sm border ${
                                inv.documentType === 'Credit Note' ? 'bg-amber-50 border-amber-100 text-amber-600' : 
                                inv.documentType === 'Debit Note' ? 'bg-indigo-50 border-indigo-100 text-indigo-600' : 
                                'bg-white border-slate-100 text-indigo-600'
                            }`}>
                                {inv.documentType === 'Credit Note' ? <FileMinus size={20} /> : inv.documentType === 'Debit Note' ? <FilePlus size={20} /> : <FileText size={20} />}
                            </div>
                            <div>
                                <span className="block text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{inv.invoiceNumber}</span>
                                {inv.billingReference && (
                                    <div className="flex items-center text-[10px] text-slate-400 mt-1 font-medium bg-slate-100 px-1.5 py-0.5 rounded w-fit">
                                        <Tag size={10} className="mr-1" /> {inv.billingReference}
                                    </div>
                                )}
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                            inv.invoiceSubtype === 'Standard' 
                            ? 'bg-purple-50 text-purple-700 border-purple-100' 
                            : 'bg-teal-50 text-teal-700 border-teal-100'
                        }`}>
                            {inv.invoiceSubtype}
                        </span>
                    </td>
                    <td className="px-6 py-5">
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold text-slate-700">{new Date(inv.issueDate || (inv as any).date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' })}</span>
                            <span className="text-xs text-slate-400 mt-0.5 font-mono">{new Date(inv.issueDate || (inv as any).date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })}</span>
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 mr-3 border border-slate-200">
                                {inv.customer.name.charAt(0)}
                            </div>
                            <div className="max-w-[160px] truncate text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                                {inv.customer.name}
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                        <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-slate-900 font-mono tracking-tight">
                                {inv.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">{inv.currencyCode || 'SAR'}</span>
                        </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border shadow-sm ${
                            inv.status === 'Cleared' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            inv.status === 'Reported' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            inv.status === 'Rejected' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            (inv.status as string).toUpperCase() === 'DLQ' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            (inv.status as string).toUpperCase() === 'FAILED' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                            {inv.status === 'Cleared' && <ShieldCheck size={12} className="mr-1.5" />}
                            {inv.status === 'Reported' && <CheckCircle size={12} className="mr-1.5" />}
                            {inv.status === 'Rejected' && <ShieldAlert size={12} className="mr-1.5" />}
                            {((inv.status as string).toUpperCase() === 'DLQ' || (inv.status as string).toUpperCase() === 'FAILED') && <ShieldAlert size={12} className="mr-1.5" />}
                            {inv.status}
                        </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                        <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === inv.id ? null : inv.id); }}
                                className={`p-2 rounded-xl transition-all duration-200 ${activeMenuId === inv.id ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-indigo-600 hover:bg-white hover:shadow-sm'}`}
                            >
                                <MoreHorizontal size={18} />
                            </button>
                            
                            {activeMenuId === inv.id && (
                                <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 z-30 animate-in fade-in zoom-in-95 duration-200 origin-top-right overflow-hidden ring-1 ring-slate-900/5">
                                    <div className="p-1.5 space-y-0.5">
                                        <button 
                                            onClick={() => onSelectInvoice(inv.id)}
                                            className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center transition-colors rounded-xl group"
                                        >
                                            <div className="p-1.5 bg-slate-100 rounded-lg mr-2 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors"><Eye size={14} /></div>
                                            View Details
                                        </button>
                                        <button 
                                            onClick={(e) => handleDownloadXML(inv, e)}
                                            className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-600 flex items-center transition-colors rounded-xl group"
                                        >
                                            <div className="p-1.5 bg-slate-100 rounded-lg mr-2 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors"><Download size={14} /></div>
                                            Download XML
                                        </button>
                                        <div className="h-px bg-slate-100 my-1 mx-2"></div>
                                        <button 
                                            onClick={(e) => handleCreateNote(inv, e)}
                                            className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-amber-600 flex items-center transition-colors rounded-xl group"
                                        >
                                            <div className="p-1.5 bg-slate-100 rounded-lg mr-2 group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors"><FileMinus size={14} /></div>
                                            Issue Credit Note
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
                ))
            ) : (
                <tr>
                    <td colSpan={7} className="px-6 py-24 text-center">
                        <div className="flex flex-col items-center justify-center text-slate-400">
                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border-2 border-dashed border-slate-200">
                                <Search size={32} className="opacity-40 text-slate-400" />
                            </div>
                            <p className="text-lg font-bold text-slate-700">No invoices found</p>
                            <p className="text-sm mt-1 mb-6 text-slate-400 max-w-xs mx-auto leading-relaxed">
                                We couldn't find any documents matching your search filters. Try adjusting your criteria.
                            </p>
                            <button 
                                onClick={() => {setSearchTerm(''); setStatusFilter('All'); setTypeFilter('All'); setDateRange('All Time');}}
                                className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm hover:shadow"
                            >
                                Clear All Filters
                            </button>
                        </div>
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

       {/* Pagination */}
       {filteredInvoices.length > 0 && (
        <div className="p-4 border-t border-slate-100 bg-white sticky bottom-0 z-30">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs font-medium text-slate-500">
                    Showing <span className="font-bold text-slate-800">{showingStart}-{showingEnd}</span> of <span className="font-bold text-slate-800">{filteredInvoices.length}</span> results
                </div>
                <div className="flex items-center space-x-2">
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="w-10 h-10 flex items-center justify-center border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-slate-200 transition-all text-slate-600 shadow-sm"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    
                    <div className="hidden sm:flex items-center space-x-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                             const pageNum = i + 1;
                             return (
                                 <button
                                    key={pageNum}
                                    onClick={() => setCurrentPage(pageNum)}
                                    className={`w-10 h-10 rounded-xl text-sm font-bold transition-all shadow-sm ${
                                        currentPage === pageNum 
                                        ? 'bg-slate-900 text-white shadow-md transform scale-105' 
                                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                                    }`}
                                 >
                                     {pageNum}
                                 </button>
                             );
                        })}
                    </div>
                    
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="w-10 h-10 flex items-center justify-center border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-slate-200 transition-all text-slate-600 shadow-sm"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
