import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  ShieldCheck, 
  Activity, 
  Settings,
  Bell,
  Menu,
  ChevronRight,
  ChevronLeft,
  Plug,
  ChevronDown,
  UserCircle,
  ExternalLink,
  BookOpen,
  AlertTriangle,
  Code,
  PlusCircle,
  LogOut,
  Building2,
  MapPin,
  Plus,
  Trash2,
  Package,
  FileBarChart,
  Layout as LayoutIcon,
  TestTube,
  FlaskConical,
  X,
  Languages
} from 'lucide-react';
import { UserRole, Organization, Branch } from '../types';
import { useLanguage } from '../services/i18n';

interface LayoutProps {
  children: React.ReactNode;
  currentRoute: string;
  onNavigate: (route: string) => void;
  userRole: UserRole;
  userName?: string;
  onLogout: () => void;
  organizations: Organization[];
  currentBranch: Branch | null;
  onSwitchBranch: (branch: Branch) => void;
  onCreateOrganization: () => void;
  onDeleteOrganization: (orgId: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({
    children,
    currentRoute,
    onNavigate,
    userRole,
    userName = "Demo User",
    onLogout,
    organizations,
    currentBranch,
    onSwitchBranch,
    onCreateOrganization,
    onDeleteOrganization
}) => {
  const { language, setLanguage, t, isRTL } = useLanguage();
  console.log('Layout rendering. Role:', userRole, 'Orgs:', organizations?.length, 'Lang:', language);
  
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  
  const notifMenuRef = useRef<HTMLDivElement>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const companyId = currentBranch?.id || 'all';
        const res = await fetch(`/api/admin/notifications/recent?companyId=${companyId}`, {
          headers: { 'x-user-role': userRole }
        });
        if (res.ok) {
          const data = await res.json();
          setNotifications(data);
          
          if (data.length > 0) {
            const lastRead = localStorage.getItem('lastNotificationRead');
            const latestNotifTime = new Date(data[0].timestamp).getTime();
            if (!lastRead || latestNotifTime > parseInt(lastRead, 10)) {
              setHasUnread(true);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching notifications', err);
      }
    };
    
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [currentBranch, userRole]);

  const handleNotificationClick = () => {
    setNotificationsOpen(!notificationsOpen);
    if (!notificationsOpen) {
      setHasUnread(false);
      localStorage.setItem('lastNotificationRead', Date.now().toString());
    }
  };

  // Close menus on Click Outside or Escape Key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(event.target as Node)) {
        setOrgMenuOpen(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setOrgMenuOpen(false);
        setNotificationsOpen(false);
        setProfileMenuOpen(false);
        setLangMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleNavClick = (routeId: string) => {
    onNavigate(routeId);
    setMobileMenuOpen(false);
  };

  // Define Navigation Items with Role Restrictions and Centralized Translations
  const standardNavItems = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard, roles: ['IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER', 'SUPER_ADMIN'] },
    { id: 'invoices', label: t.navInvoices, icon: FileText, roles: ['IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER'] },
    { id: 'items', label: t.navItemMaster, icon: Package, roles: ['IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER'] },
    { id: 'create-invoice', label: t.navNewInvoice, icon: PlusCircle, roles: ['IT_ADMIN', 'FINANCE_ADMIN'] },
    { id: 'validator', label: t.navXmlValidator, icon: Code, roles: ['IT_ADMIN', 'FINANCE_ADMIN'] },
    { id: 'certificates', label: t.navCsrSettings, icon: ShieldCheck, roles: ['IT_ADMIN'] },
    { id: 'erp-connectors', label: t.navErpConnectors, icon: Plug, roles: ['IT_ADMIN'] },
    { id: 'reports', label: t.navReportCenter, icon: FileBarChart, roles: ['IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER', 'SUPER_ADMIN'] },
    { id: 'audit', label: t.navAuditLog, icon: Activity, roles: ['IT_ADMIN', 'FINANCE_ADMIN', 'TAX_OFFICER', 'SUPER_ADMIN'] },
  ];

  const adminNavItems = [
    { id: 'users', label: t.navUserManagement, icon: UserCircle, roles: ['SUPER_ADMIN'] },
    { id: 'report-designer', label: t.navReportDesigner, icon: LayoutIcon, roles: ['SUPER_ADMIN'] },
    { id: 'api-docs', label: t.navApiDocs, icon: Code, roles: ['SUPER_ADMIN'] },
  ];

  const filteredNavItems = standardNavItems.filter(item => item.roles.includes(userRole));
  const filteredAdminItems = adminNavItems.filter(item => item.roles.includes(userRole));

  const roleLabels: Record<UserRole, string> = {
    IT_ADMIN: t.roleItAdmin,
    FINANCE_ADMIN: t.roleFinanceAdmin,
    TAX_OFFICER: t.roleTaxOfficer,
    SUPER_ADMIN: t.roleSuperAdmin
  };

  // Find Current Organization for display
  const currentOrg = organizations.find(o => o.id === currentBranch?.organizationId);

  const renderEnvironmentBadge = () => {
    if (!currentBranch) return null;
    
    const env = currentBranch.environment || (currentOrg?.environment) || 'SANDBOX';
    
    const configs = {
      SIMULATION: {
        label: t.envSimulation,
        icon: TestTube,
        styles: 'bg-amber-100 text-amber-700 border-amber-200',
        pulse: 'bg-amber-500'
      },
      SANDBOX: {
        label: t.envSandbox,
        icon: FlaskConical,
        styles: 'bg-blue-100 text-blue-700 border-blue-200',
        pulse: 'bg-blue-500'
      },
      PRODUCTION: {
        label: t.envProduction,
        icon: ShieldCheck,
        styles: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        pulse: 'bg-emerald-500'
      }
    };

    const config = configs[env as keyof typeof configs] || configs.SANDBOX;
    const Icon = config.icon;

    return (
      <div className={`flex items-center px-3.5 h-8 rounded-full border shadow-sm transition-all ${config.styles} font-bold text-[10px] uppercase tracking-wider select-none shrink-0`}>
         <span className={`w-2 h-2 rounded-full ${isRTL ? 'ml-2' : 'mr-2'} animate-pulse ${config.pulse} shadow-sm`}></span>
         <Icon size={13} className={isRTL ? 'ml-1.5' : 'mr-1.5'} />
         <span>{config.label}</span>
      </div>
    );
  };

  const ChevronActive = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className={`flex h-screen bg-slate-50 overflow-hidden font-sans ${isRTL ? 'rtl' : 'ltr'}`}>
      {/* Mobile Drawer Backdrop Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - Desktop static collapsible, Mobile off-canvas drawer */}
      <aside 
        className={`fixed inset-y-0 ${isRTL ? 'right-0 border-l' : 'left-0 border-r'} z-50 md:static md:z-30 ${
          sidebarOpen ? 'w-72' : 'w-20'
        } bg-[#0f172a] text-white transition-all duration-300 ease-in-out flex flex-col shadow-2xl border-slate-800 ${
          mobileMenuOpen 
            ? 'translate-x-0 w-72' 
            : (isRTL ? 'translate-x-full md:translate-x-0' : '-translate-x-full md:translate-x-0')
        }`}
      >
        <div className="h-16 flex items-center justify-between px-6 bg-[#0f172a] border-b border-slate-800">
          {(sidebarOpen || mobileMenuOpen) ? (
            <div className="flex items-center space-x-2.5 rtl:space-x-reverse">
              <img src="/alwadi-logo.png" alt="Alwadi Logo" className="w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5" />
              <span className="text-lg font-bold tracking-tight text-white">
                ZATCA<span className="text-emerald-400">Connect</span>
              </span>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center mx-auto bg-white/10 p-0.5">
              <img src="/alwadi-logo.png" alt="Alwadi Logo" className="w-full h-full object-contain" />
            </div>
          )}
          {/* Desktop collapse toggle */}
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className={`hidden md:block p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors ${!sidebarOpen && 'hidden'}`}
            title={t.collapseSidebar}
          >
            <Menu size={18} />
          </button>
          {/* Mobile close toggle */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title={t.closeMenu}
          >
            <X size={20} />
          </button>
        </div>

        {!sidebarOpen && (
           <div className="hidden md:flex justify-center py-4 border-b border-slate-800">
             <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400" title={t.expandSidebar}>
               <Menu size={20} />
             </button>
           </div>
        )}

        {/* Organization / Branch Switcher */}
        {(sidebarOpen || mobileMenuOpen) && (
            <div className="px-3 py-4" ref={orgMenuRef}>
                <button 
                    onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                    className="w-full bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-xl p-3 flex items-center justify-between transition-all group min-h-[44px]"
                >
                    <div className="flex items-center overflow-hidden">
                        <div className={`w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shrink-0 ${isRTL ? 'ml-3' : 'mr-3'} shadow-inner`}>
                            <Building2 size={16} />
                        </div>
                        <div className="text-start overflow-hidden">
                            <p className="text-sm font-bold text-white truncate group-hover:text-indigo-200 transition-colors">{currentOrg?.name || t.selectOrg}</p>
                            <p className="text-[10px] text-slate-400 truncate flex items-center uppercase tracking-wide font-medium mt-0.5">
                                <MapPin size={10} className={`${isRTL ? 'ml-1' : 'mr-1'} shrink-0`} /> {currentBranch?.name}
                            </p>
                        </div>
                    </div>
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${orgMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {orgMenuOpen && (
                    <div className="mt-2 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl animate-in fade-in slide-in-from-top-2">
                        <div className="max-h-60 overflow-y-auto dark-scroll">
                            {organizations.map(org => (
                                <div key={org.id}>
                                    <div className="px-4 py-2 bg-slate-900/50 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 flex justify-between items-center group">
                                        <span>{org.name}</span>
                                        {userRole === 'SUPER_ADMIN' && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Are you sure you want to delete ${org.name}? This action cannot be undone.`)) {
                                                        onDeleteOrganization(org.id);
                                                    }
                                                }}
                                                className="text-rose-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-800 rounded min-h-[32px] min-w-[32px] flex items-center justify-center"
                                                title={t.deleteOrg}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                    {org.branches.map(branch => (
                                        <button
                                            key={branch.id}
                                            onClick={() => {
                                                onSwitchBranch(branch);
                                                setOrgMenuOpen(false);
                                            }}
                                            className={`w-full text-start px-4 py-2.5 text-sm flex items-center hover:bg-slate-700 transition-colors min-h-[44px] ${
                                                currentBranch?.id === branch.id ? 'text-indigo-400 bg-slate-700/50' : 'text-slate-300'
                                            }`}
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full ${isRTL ? 'ml-3' : 'mr-3'} ${currentBranch?.id === branch.id ? 'bg-indigo-400' : 'bg-slate-600'}`}></div>
                                            {branch.name}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="p-2 border-t border-slate-700 bg-slate-900/30">
                            {userRole === 'SUPER_ADMIN' ? (
                                <button 
                                    onClick={() => {
                                        setOrgMenuOpen(false);
                                        onCreateOrganization();
                                    }}
                                    className="w-full flex items-center justify-center py-2.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:bg-slate-700 rounded-lg transition-colors min-h-[44px]"
                                >
                                    <Plus size={14} className={isRTL ? 'ml-1.5' : 'mr-1.5'} /> {t.addOrganization}
                                </button>
                            ) : (
                                <div className="py-2 text-center">
                                    <span className="text-[10px] text-slate-500 italic">Organization management restricted</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        )}

        <div className="flex-1 py-2 px-3 space-y-1 overflow-y-auto dark-scroll">
          {(sidebarOpen || mobileMenuOpen) && <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-2">{t.menuHeader}</p>}
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentRoute === item.id || (currentRoute === 'invoice-detail' && item.id === 'invoices');
            const isAction = item.id === 'create-invoice';
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center px-3 py-3 rounded-lg transition-all duration-200 group relative min-h-[44px] ${
                  isActive 
                    ? `bg-slate-800 text-white shadow-md ${isRTL ? 'border-r-4 border-green-500' : 'border-l-4 border-green-500'}` 
                    : isAction 
                      ? 'text-green-400 hover:bg-slate-800/80 hover:text-green-300 border border-green-900/50 bg-green-900/10 mb-2' 
                      : `text-slate-400 hover:bg-slate-800/50 hover:text-white ${isRTL ? 'border-r-4 border-transparent' : 'border-l-4 border-transparent'}`
                }`}
              >
                <Icon size={20} className={`min-w-[20px] ${isActive ? 'text-green-400' : isAction ? 'text-green-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'}`} />
                {(sidebarOpen || mobileMenuOpen) && (
                  <>
                    <span className={`${isRTL ? 'mr-3' : 'ml-3'} font-medium text-sm`}>{item.label}</span>
                    {isActive && <ChevronActive size={14} className={`${isRTL ? 'mr-auto' : 'ml-auto'} text-slate-500`} />}
                  </>
                )}
              </button>
            );
          })}

          {filteredAdminItems.length > 0 && (
            <div className="mt-8 pt-4 border-t border-slate-800/50">
              {(sidebarOpen || mobileMenuOpen) && <p className="px-3 text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-3">{t.saasConsoleHeader}</p>}
              {filteredAdminItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentRoute === item.id;
                
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center px-3 py-3 rounded-lg transition-all duration-200 group relative min-h-[44px] ${
                      isActive 
                        ? `bg-indigo-900/30 text-indigo-200 ${isRTL ? 'border-r-4 border-indigo-500' : 'border-l-4 border-indigo-500'} shadow-inner` 
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-indigo-300'
                    }`}
                  >
                    <Icon size={18} className={`min-w-[18px] ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-indigo-400 transition-colors'}`} />
                    {(sidebarOpen || mobileMenuOpen) && <span className={`${isRTL ? 'mr-3' : 'ml-3'} font-medium text-sm`}>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-[#0f172a]">
          <button 
            onClick={() => handleNavClick('settings')}
            className={`flex items-center w-full p-2.5 rounded-lg transition-colors min-h-[44px] ${currentRoute === 'settings' ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
          >
            <Settings size={20} />
            {(sidebarOpen || mobileMenuOpen) && <span className={`${isRTL ? 'mr-3' : 'ml-3'} text-sm font-medium`}>{t.navSettings}</span>}
          </button>
          
          {(sidebarOpen || mobileMenuOpen) && (
            <div className="mt-4 pt-4 border-t border-slate-800 relative">
              <button 
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className="flex items-center w-full hover:bg-slate-800/50 p-2 rounded-lg transition-colors min-h-[44px]"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-slate-800 shrink-0">
                  {userRole.slice(0,2)}
                </div>
                <div className={`${isRTL ? 'mr-3 text-right' : 'ml-3 text-left'} flex-1 min-w-0`}>
                  <p className="text-sm font-medium text-white truncate">{userName}</p>
                  <p className="text-[10px] text-slate-500 truncate uppercase tracking-wide">{roleLabels[userRole]}</p>
                </div>
                <ChevronDown size={14} className={`text-slate-400 shrink-0 ${isRTL ? 'mr-1' : 'ml-1'}`} />
              </button>

              {/* Profile / Logout Menu */}
              {profileMenuOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-slate-800 rounded-xl shadow-xl border border-slate-700 overflow-hidden animate-in slide-in-from-bottom-2 fade-in">
                  <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {t.myAccount}
                  </div>
                  {userRole === 'SUPER_ADMIN' && (
                    <button 
                        onClick={() => {
                            handleNavClick('users');
                            setProfileMenuOpen(false);
                        }}
                        className="w-full text-start px-4 py-3 text-sm text-indigo-400 hover:bg-slate-700 hover:text-indigo-300 transition-colors flex items-center border-b border-slate-700 min-h-[44px]"
                    >
                        <ShieldCheck size={14} className={`${isRTL ? 'ml-2' : 'mr-2'} shrink-0`} /> {t.saasMasterConsole}
                    </button>
                  )}
                  <button 
                    onClick={onLogout}
                    className="w-full text-start px-4 py-3 text-sm text-rose-400 hover:bg-slate-700 hover:text-rose-300 transition-colors flex items-center min-h-[44px]"
                  >
                    <LogOut size={14} className={`${isRTL ? 'ml-2' : 'mr-2'} shrink-0`} /> {t.signOut}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative w-full min-w-0">
        {/* Responsive Header */}
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-3 sm:px-6 lg:px-8 z-20 sticky top-0 shadow-sm gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger Button for Mobile */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg md:hidden shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={t.openMobileMenu}
            >
              <Menu size={22} />
            </button>

            <h1 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight truncate">
              {currentRoute === 'dashboard' && t.titleDashboard}
              {currentRoute === 'invoices' && t.titleInvoices}
              {currentRoute === 'create-invoice' && t.titleCreateInvoice}
              {currentRoute === 'invoice-detail' && t.titleInvoiceDetail}
              {currentRoute === 'items' && t.titleItems}
              {currentRoute === 'certificates' && t.titleCertificates}
              {currentRoute === 'erp-connectors' && t.titleErpConnectors}
              {currentRoute === 'audit' && t.titleAudit}
              {currentRoute === 'reports' && t.titleReports}
              {currentRoute === 'report-designer' && t.titleReportDesigner}
              {currentRoute === 'settings' && t.titleSettings}
            </h1>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 rtl:space-x-reverse shrink-0">
            <div className="hidden sm:flex items-center">
              {renderEnvironmentBadge()}
            </div>

            {/* Language Selector Controls */}
            <div className="relative flex items-center" ref={langMenuRef}>
              <button
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-1.5 px-3.5 h-8 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-full text-xs font-bold transition-all border border-slate-200 shadow-sm cursor-pointer select-none"
                aria-label={t.language}
                title={t.language}
              >
                <Languages size={14} className="text-indigo-600 shrink-0" />
                <span className="hidden sm:inline">{language === 'ar' ? 'العربية' : 'English'}</span>
                <span className="sm:hidden">{language === 'ar' ? 'عرب' : 'EN'}</span>
                <ChevronDown size={12} className="text-slate-400 shrink-0" />
              </button>

              {langMenuOpen && (
                <div className={`absolute ${isRTL ? 'left-0' : 'right-0'} mt-2 w-36 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-150`}>
                  <button
                    onClick={() => {
                      setLanguage('en');
                      setLangMenuOpen(false);
                    }}
                    className={`w-full text-start px-4 py-2.5 text-xs font-medium flex items-center justify-between transition-colors min-h-[40px] ${language === 'en' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span>English</span>
                    {language === 'en' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>}
                  </button>
                  <button
                    onClick={() => {
                      setLanguage('ar');
                      setLangMenuOpen(false);
                    }}
                    className={`w-full text-start px-4 py-2.5 text-xs font-medium flex items-center justify-between transition-colors min-h-[40px] ${language === 'ar' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span>العربية</span>
                    {language === 'ar' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>}
                  </button>
                </div>
              )}
            </div>

            {/* Notifications Menu */}
            <div className="relative" ref={notifMenuRef}>
              <button 
                onClick={handleNotificationClick}
                className="relative p-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label={t.notifications}
              >
                <Bell size={20} />
                {hasUnread && (
                  <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-white"></span>
                )}
              </button>

              {notificationsOpen && (
                <div className={`absolute ${isRTL ? 'left-0' : 'right-0'} mt-2 w-72 sm:w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden flex flex-col max-h-96`}>
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 font-medium text-slate-700 flex justify-between items-center">
                     <span>{t.notifications}</span>
                     {notifications.length > 0 && <span className="text-xs bg-indigo-100 text-indigo-700 py-0.5 px-2 rounded-full">{notifications.length}</span>}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-500">No new notifications</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {notifications.map((notif, idx) => (
                          <div key={idx} className="p-3 hover:bg-slate-50 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                              <span className={`text-[10px] uppercase font-bold tracking-wider ${notif.status === 'Failure' ? 'text-rose-600' : (notif.status === 'Warning' ? 'text-amber-600' : 'text-indigo-600')}`}>
                                {notif.status === 'Failure' ? 'Critical' : (notif.status === 'Warning' ? 'Warning' : 'System')}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(notif.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>
                            <div className="text-sm text-slate-700 font-medium leading-tight mb-1">
                              {notif.action.replace('SYSTEM_ALERT: ', '')}
                            </div>
                            <div className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                              {notif.details}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Responsive Content Container */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-6 lg:p-8 relative">
          <div className="absolute inset-0 z-0 opacity-[0.4]" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
          <div className="max-w-7xl mx-auto h-full space-y-6 relative z-10 min-w-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
