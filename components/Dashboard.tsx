
import React, { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Filter,
  ChevronDown,
  TrendingUp,
  ArrowRight,
  Calendar,
  Wallet,
  AlertTriangle,
  MoreHorizontal
} from 'lucide-react';
import { Branch } from '../types';
import { getInvoices } from '../services/api';

interface DashboardProps {
  onNavigate: (route: string) => void;
  selectedBranch: Branch | null;
  userRole: string;
  userEmail: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, selectedBranch, userRole, userEmail }) => {
  const [timeRange, setTimeRange] = useState<string>('All Time');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [invoices, setInvoices] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchInvoices = async () => {
      if (!selectedBranch) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await getInvoices(selectedBranch.organizationId || selectedBranch.id.toString(), {
          role: userRole,
          email: userEmail
        });
        setInvoices(data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInvoices();

    // Polling for real-time updates (every 30 seconds)
    const interval = setInterval(() => {
      if (!selectedBranch) return;
      // Silent refresh (don't set loading to true)
      getInvoices(selectedBranch.organizationId || selectedBranch.id.toString(), {
        role: userRole,
        email: userEmail
      })
        .then(setInvoices)
        .catch(err => console.error('Dashboard poll failed:', err));
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, [selectedBranch]);

  // 1. Filter Invoices based on Time Range and Branch
  const filteredInvoices = useMemo(() => {
    let relevantInvoices = invoices;

    if (selectedBranch) {
      relevantInvoices = relevantInvoices.filter(inv => {
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

        // 3. Fallback for unassigned/general invoices ONLY if viewing HQ
        const isHq = selectedBranch.type === 'HQ' || selectedBranch.code === 'BR-001' || selectedBranch.code === 'BR-HQ-01' || selectedBranch.name?.toLowerCase().includes('hq');
        if (isHq && (!inv.branchId || inv.branchId === `br-${selectedBranch.organizationId}`)) {
          return true;
        }

        return false;
      });
    }

    const now = new Date();
    if (timeRange === 'All Time') return relevantInvoices;

    let startDate = new Date();

    switch (timeRange) {
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
      case 'Custom':
        if (!customStart) return relevantInvoices;
        startDate = new Date(customStart);
        break;
      default:
        startDate.setMonth(now.getMonth() - 1);
    }

    startDate.setHours(0, 0, 0, 0);

    return relevantInvoices.filter(inv => {
      const invDate = new Date(inv.issueDate);
      if (timeRange === 'Custom' && customEnd) {
        const endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
        return invDate >= startDate && invDate <= endDate;
      }
      return invDate >= startDate;
    });
  }, [invoices, timeRange, customStart, customEnd, selectedBranch]);

  // 2. Calculate Stats based on Filtered Data
  const stats = useMemo(() => {
    const totalVol = filteredInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    return {
      totalCount: filteredInvoices.length,
      totalVolume: totalVol,
      cleared: filteredInvoices.filter(i => i.status === 'Cleared' || i.status === 'Reported').length,
      reported: filteredInvoices.filter(i => i.status === 'Reported').length,
      rejected: filteredInvoices.filter(i => i.status === 'Rejected').length,
      pending: filteredInvoices.filter(i => i.status === 'Pending').length,
    };
  }, [filteredInvoices]);

  // 3. Generate Chart Data (Group by Date)
  const chartData = useMemo(() => {
    const dataMap: Record<string, { date: number, name: string, fullDate: string, cleared: number, rejected: number, pending: number, total: number, volume: number }> = {};

    if (filteredInvoices.length === 0) return [];

    filteredInvoices.forEach(inv => {
      const d = new Date(inv.issueDate);
      const dateKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (!dataMap[dateKey]) {
        dataMap[dateKey] = {
          date: d.getTime(),
          name: dateKey,
          fullDate: d.toLocaleDateString(),
          cleared: 0,
          rejected: 0,
          pending: 0,
          total: 0,
          volume: 0
        };
      }

      dataMap[dateKey].total += 1;
      dataMap[dateKey].volume += inv.totalAmount;

      if (inv.status === 'Cleared' || inv.status === 'Reported') {
        dataMap[dateKey].cleared += 1;
      } else if (inv.status === 'Rejected' || inv.status === 'Failed') {
        dataMap[dateKey].rejected += 1;
      } else {
        dataMap[dateKey].pending += 1;
      }
    });

    return Object.values(dataMap).sort((a, b) => a.date - b.date);
  }, [filteredInvoices]);

  // 4. Data for Pie Chart
  const pieData = useMemo(() => [
    { name: 'Cleared', value: stats.cleared, color: '#10b981' }, // Emerald 500
    { name: 'Reported', value: stats.reported, color: '#3b82f6' }, // Blue 500
    { name: 'Pending', value: stats.pending, color: '#f59e0b' }, // Amber 500
    { name: 'Rejected', value: stats.rejected, color: '#ef4444' }, // Rose 500
  ].filter(d => d.value > 0), [stats]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs">
          <p className="font-bold mb-2 text-slate-300">{payload[0].payload.fullDate}</p>
          <div className="space-y-1">
            <p className="flex items-center justify-between gap-4">
              <span className="text-indigo-400">Volume:</span>
              <span className="font-mono font-bold">SAR {payload[0].payload.volume.toLocaleString()}</span>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-emerald-400">Cleared:</span>
              <span className="font-bold">{payload[0].payload.cleared}</span>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-rose-400">Rejected:</span>
              <span className="font-bold">{payload[0].payload.rejected}</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  const Card = ({ title, value, subtext, icon: Icon, colorClass, bgClass, onClick, trend, trendUp }: any) => (
    <div
      onClick={onClick}
      className="bg-white p-6 rounded-2xl shadow-[0_2px_10px_-4px_rgba(6,81,237,0.1)] border border-slate-100 hover:border-indigo-100 hover:shadow-lg transition-all duration-300 cursor-pointer group relative overflow-hidden"
    >
      <div className="flex items-start justify-between relative z-10">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <div className={`p-2 rounded-lg ${bgClass} ${colorClass}`}>
              <Icon size={18} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{title}</p>
          </div>
          <h3 className="text-3xl font-bold text-slate-900 tracking-tight">{value}</h3>

          <div className="flex items-center mt-3 gap-2">
            {trend && (
              <span className={`flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${trendUp ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-rose-600 bg-rose-50 border-rose-100'}`}>
                <TrendingUp size={10} className={`mr-1 ${!trendUp && 'rotate-180'}`} /> {trend}
              </span>
            )}
            <p className="text-xs font-medium text-slate-400 truncate">
              {subtext}
            </p>
          </div>
        </div>

        <div className="absolute top-1/2 right-4 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
          <div className="bg-slate-50 p-2 rounded-full text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
            <ArrowRight size={18} />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">

      {/* Environment Status Ribbon */}
      {selectedBranch && (
        <div className={`p-3 rounded-2xl border flex items-center justify-between animate-in slide-in-from-top duration-500 ${selectedBranch.environment === 'SIMULATION'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : selectedBranch.environment === 'SANDBOX'
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${selectedBranch.environment === 'SIMULATION' ? 'bg-amber-100 text-amber-600' :
                selectedBranch.environment === 'SANDBOX' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'
              }`}>
              {selectedBranch.environment === 'SIMULATION' ? <AlertTriangle size={18} /> : <Activity size={18} />}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest opacity-60">System Mode</p>
              <p className="text-sm font-bold flex items-center gap-2">
                {selectedBranch.environment === 'SIMULATION' ? 'Simulation (Local Mocks Only)' :
                  selectedBranch.environment === 'SANDBOX' ? 'Sandbox (Real-time ZATCA Replica)' : 'Production (Live Tax Compliance)'}
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${selectedBranch.environment === 'SIMULATION' ? 'bg-amber-500' :
                    selectedBranch.environment === 'SANDBOX' ? 'bg-blue-500' : 'bg-emerald-500'
                  }`}></span>
              </p>
            </div>
          </div>
          <div className="hidden sm:block">
            <p className="text-[10px] font-medium max-w-[200px] text-right opacity-70">
              {selectedBranch.environment === 'SIMULATION'
                ? 'All ZATCA API calls are currently bypassed using local signature mocks.'
                : selectedBranch.environment === 'SANDBOX'
                  ? 'Connected to ZATCA Fatoora Sandbox. CSR and Certificates must be Sandbox-specific.'
                  : 'Connected to ZATCA Production. Every submission is a real legal tax event.'}
            </p>
          </div>
        </div>
      )}

      {/* Header & Filter Toolbar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard Overview</h2>
          <div className="flex items-center text-sm text-slate-500 mt-1">
            <Activity size={14} className="mr-1.5 text-indigo-500" />
            <span>Real-time compliance monitoring for </span>
            <span className="font-bold text-slate-700 ml-1 bg-slate-100 px-2 py-0.5 rounded-md">
              {selectedBranch ? selectedBranch.name : 'All Branches'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm w-full lg:w-auto">
          <div className="relative flex-1 lg:flex-none">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <Calendar size={14} />
            </div>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full lg:w-40 appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg py-2 pl-9 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer transition-colors"
            >
              <option value="Weekly">Last 7 Days</option>
              <option value="Monthly">Last 30 Days</option>
              <option value="Quarterly">Last Quarter</option>
              <option value="Yearly">Last Year</option>
              <option value="All Time">All Time</option>
              <option value="Custom">Custom Range</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          {timeRange === 'Custom' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
              <div className="h-6 w-px bg-slate-200"></div>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg py-2 px-2 focus:outline-none focus:border-indigo-500"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg py-2 px-2 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100">
            <Filter size={18} />
          </button>
        </div>
      </div>

      {loading && invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-slate-400 bg-white/50 backdrop-blur-sm rounded-2xl border border-slate-100 border-dashed animate-in fade-in duration-500">
          <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-sm font-medium">Aggregating real-time compliance data...</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <Card
          title="Total Volume"
          value={stats.totalVolume >= 1000000
            ? `SAR ${(stats.totalVolume / 1000000).toFixed(2)}M`
            : `SAR ${stats.totalVolume.toLocaleString()}`}
          subtext={`${stats.totalCount} total documents`}
          icon={Wallet}
          colorClass="text-indigo-600"
          bgClass="bg-indigo-50"
          trend="+12%"
          trendUp={true}
          onClick={() => onNavigate('invoices')}
        />
        <Card
          title="Cleared Invoices"
          value={stats.cleared}
          subtext={`${stats.totalCount > 0 ? ((stats.cleared / stats.totalCount) * 100).toFixed(1) : 0}% Success Rate`}
          icon={CheckCircle}
          colorClass="text-emerald-600"
          bgClass="bg-emerald-50"
          trend="+5.2%"
          trendUp={true}
          onClick={() => onNavigate('invoices')}
        />
        <Card
          title="Rejected"
          value={stats.rejected}
          subtext="Requires immediate attention"
          icon={XCircle}
          colorClass="text-rose-600"
          bgClass="bg-rose-50"
          trend="-2%"
          trendUp={false} // Good that it's down
          onClick={() => onNavigate('invoices')}
        />
        <Card
          title="Pending Queue"
          value={stats.pending}
          subtext="Awaiting ZATCA response"
          icon={Clock}
          colorClass="text-amber-600"
          bgClass="bg-amber-50"
          onClick={() => onNavigate('invoices')}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Main Trend Chart */}
        <div className="xl:col-span-2 bg-white p-6 rounded-2xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-slate-100 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Daily Submission Volume</h3>
              <p className="text-sm text-slate-500">Transaction trends and clearance status</p>
            </div>
            <button className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
              <MoreHorizontal size={20} />
            </button>
          </div>

          <div className="h-80 w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              {chartData.length > 0 ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                    dy={10}
                    minTickGap={20}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={(value) => `SAR ${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    stroke="#6366f1"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorVolume)"
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </AreaChart>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-100">
                  <Activity size={32} className="mb-2 opacity-30" />
                  <p className="text-sm font-medium">No data available for selected period</p>
                </div>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution (Donut Chart) */}
        <div className="bg-white p-6 rounded-2xl shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-slate-100 flex flex-col">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Status Breakdown</h3>
          <p className="text-sm text-slate-500 mb-6">Distribution by compliance status</p>

          <div className="flex-1 relative min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              {pieData.length > 0 ? (
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  />
                </PieChart>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">
                  No Data
                </div>
              )}
            </ResponsiveContainer>

            {/* Center Label */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <span className="block text-2xl font-bold text-slate-900">{stats.totalCount}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Invoices</span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                  <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{item.value}</span>
                  <span className="text-xs text-slate-400 font-mono w-8 text-right">
                    {((item.value / stats.totalCount) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
