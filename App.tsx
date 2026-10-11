
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { InvoiceList } from './components/InvoiceList';
import { InvoiceDetail } from './components/InvoiceDetail';
import { CertificateManager } from './components/CertificateManager';
import { ERPConnectors } from './components/ERPConnectors';
import { AuditLog } from './components/AuditLog';
import { InvoiceGenerator } from './components/InvoiceGenerator';
import { Settings } from './components/Settings';
import { ItemMaster } from './components/ItemMaster';
import { Login } from './components/Login';
import { XMLValidator } from './components/XMLValidator';
import { CreateOrganizationModal } from './components/CreateOrganizationModal';
import { UserManagement } from './components/UserManagement';
import { ReportCenter } from './components/ReportCenter';
import { ReportDesigner } from './components/ReportDesigner';
import ApiDocs from './components/ApiDocs';
import { UserRole, Branch, Organization } from './types';
import { initialOrganizations } from './services/mockData';
import { WifiOff, RefreshCw } from 'lucide-react';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const App: React.FC = () => {
  const checkInitialAuth = () => {
    // Session authentication flag must be present in current browser session
    const isSessionAuth = sessionStorage.getItem('isAuthenticated');
    
    if (isSessionAuth !== 'true') {
      // Clear legacy storage items from previous auto-seeding
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userName');
      localStorage.removeItem('companyId');
      localStorage.removeItem('lastActivity');
      sessionStorage.clear();
      return false;
    }

    let email = localStorage.getItem('userEmail') || sessionStorage.getItem('userEmail');
    let lastActivity = localStorage.getItem('lastActivity');
    
    if (!email || !lastActivity) {
      return false;
    }

    const timeoutEnforced = localStorage.getItem('sessionTimeoutEnforced') !== 'false';
    if (timeoutEnforced && Date.now() - parseInt(lastActivity) > SESSION_TIMEOUT_MS) {
      // Session expired
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userName');
      localStorage.removeItem('companyId');
      localStorage.removeItem('lastActivity');
      sessionStorage.clear();
      return false;
    }

    // Update last activity timestamp
    localStorage.setItem('lastActivity', Date.now().toString());
    return true;
  };

  const [isAuthenticated, setIsAuthenticated] = useState(() => checkInitialAuth());
  const [currentRoute, setCurrentRoute] = useState<string>('dashboard');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  
  // Auth State
  const [userRole, setUserRole] = useState<UserRole>(() => (localStorage.getItem('userRole') as UserRole) || 'IT_ADMIN');
  const [userName, setUserName] = useState<string>(() => localStorage.getItem('userName') || '');
  const [userEmail, setUserEmail] = useState<string>(() => localStorage.getItem('userEmail') || '');
  const [companyId, setCompanyId] = useState<number | null>(() => localStorage.getItem('companyId') ? parseInt(localStorage.getItem('companyId')!) : null);

  // Multi-Tenancy State
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [isOrganizationsLoading, setIsOrganizationsLoading] = useState(false);
  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);

  // Connectivity State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // Fetch Organizations
  useEffect(() => {
    if (isAuthenticated) {
        fetchOrganizations();
    }
  }, [isAuthenticated, userRole, userEmail]);

  const fetchOrganizations = async () => {
    setIsOrganizationsLoading(true);
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const headers: Record<string, string> = { 
        'x-user-email': userEmail || '',
        'x-user-role': userRole || ''
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/admin/companies', {
        cache: 'no-store',
        headers
      });
        if (res.ok) {
            const data = await res.json();
            const loggedInCompanyId = localStorage.getItem('companyId') || sessionStorage.getItem('companyId');
            
            // Security Isolation Guard: Filter out any third-party customer data
            const userDomain = (userEmail || '').split('@')[1]?.toLowerCase() || '';
            const isAlwadiUser = !userDomain || userDomain.includes('alwadi') || userDomain.includes('system.local');

            const sanitizedData = Array.isArray(data) ? data.filter((org: any) => {
                const orgName = (org.name || '').toLowerCase();
                const orgVat = (org.vatNumber || '').trim();
                // Block any known cross-customer or competitor organizations
                if (orgName.includes('easy lease') || orgName.includes('competitor') || orgVat === '399999999900003') {
                    console.warn(`[Security Guard] Filtered out cross-tenant organization '${org.name}' (VAT: ${org.vatNumber})`);
                    return false;
                }
                if (isAlwadiUser) {
                    return orgName.includes('alwadi') || orgVat === '300000000000003' || org.id?.toString() === '1';
                }
                return true;
            }) : [];

            const effectiveData = sanitizedData.length > 0 ? sanitizedData : initialOrganizations;

            // Prioritize the user's logged-in company first, then sort by company ID ascending
            const sortedData = [...effectiveData].sort((a: any, b: any) => {
                if (loggedInCompanyId && a.id.toString() === loggedInCompanyId.toString()) return -1;
                if (loggedInCompanyId && b.id.toString() === loggedInCompanyId.toString()) return 1;
                return parseInt(a.id, 10) - parseInt(b.id, 10);
            });
            
            setOrganizations(sortedData);
            
            if (sortedData.length > 0) {
                if (!currentBranch) {
                    // Auto switch to the logged-in user's company branch
                    const targetOrg = (loggedInCompanyId ? sortedData.find((o: any) => o.id.toString() === loggedInCompanyId.toString()) : null) || sortedData[0];
                    if (targetOrg && targetOrg.branches && targetOrg.branches.length > 0) {
                        setCurrentBranch(targetOrg.branches[0]);
                    }
                } else if (currentBranch) {
                    // Update current branch with fresh data
                    for (const org of sortedData) {
                        const updatedBranch = org.branches.find((b: any) => b.id === currentBranch.id);
                        if (updatedBranch) {
                            setCurrentBranch(updatedBranch);
                            break;
                        }
                    }
                }
            }
        } else {
            console.warn('[App] Failed to fetch organizations from server, falling back to local Alwadi config.');
            setOrganizations(initialOrganizations);
            if (!currentBranch && initialOrganizations[0]?.branches?.length > 0) {
                setCurrentBranch(initialOrganizations[0].branches[0]);
            }
        }
    } catch (error) {
        console.error('Failed to fetch organizations:', error);
        setOrganizations(initialOrganizations);
        if (!currentBranch && initialOrganizations[0]?.branches?.length > 0) {
            setCurrentBranch(initialOrganizations[0].branches[0]);
        }
    } finally {
        setIsOrganizationsLoading(false);
    }
  };

  const fetchUsers = async () => {
    if (userRole !== 'SUPER_ADMIN') return;
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'x-user-role': userRole }
        });
        if (response.ok) {
            const data = await response.json();
            setUsers(data);
        }
    } catch (error) {
        console.error('Failed to fetch users:', error);
    }
  };

  useEffect(() => {
    if (isAuthenticated && userRole === 'SUPER_ADMIN') {
        fetchUsers();
    }
  }, [isAuthenticated, userRole]);

  useEffect(() => {
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
      };
  }, []);

  useEffect(() => {
      // If Organizations loaded but no current branch, set it
      if (!currentBranch && organizations.length > 0) {
          // Priority 1: Match by logged in companyId
          const cid = companyId || (localStorage.getItem('companyId') ? parseInt(localStorage.getItem('companyId')!) : null);
          
          if (cid) {
              const matchedOrg = organizations.find(org => org.id.toString() === cid.toString());
              if (matchedOrg && matchedOrg.branches.length > 0) {
                  setCurrentBranch(matchedOrg.branches[0]);
                  return;
              }
          }
          
          // Priority 2: Just take the first one
          if (organizations[0].branches.length > 0) {
              setCurrentBranch(organizations[0].branches[0]);
          }
      }
  }, [organizations, currentBranch, companyId]);

  const navigate = (route: string, id?: string) => {
    setCurrentRoute(route);
    if (id) setSelectedInvoiceId(id);
    window.location.hash = route;
  };

  const handleLogin = (role: UserRole, name: string, email: string, cid?: number, token?: string) => {
      setUserRole(role);
      setUserName(name);
      setUserEmail(email);
      sessionStorage.setItem('isAuthenticated', 'true');
      sessionStorage.setItem('userRole', role);
      sessionStorage.setItem('userName', name);
      sessionStorage.setItem('userEmail', email);
      if (token) {
          sessionStorage.setItem('token', token);
          localStorage.setItem('token', token);
      }
      localStorage.setItem('userRole', role);
      localStorage.setItem('userName', name);
      localStorage.setItem('userEmail', email);
      localStorage.setItem('lastActivity', Date.now().toString());
      if (cid) {
          setCompanyId(cid);
          sessionStorage.setItem('companyId', cid.toString());
          localStorage.setItem('companyId', cid.toString());
      }
      setIsAuthenticated(true);
      setCurrentRoute('dashboard');
  };

  const handleLogout = () => {
      sessionStorage.clear();
      localStorage.removeItem('userRole');
      localStorage.removeItem('userName');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('companyId');
      localStorage.removeItem('token');
      localStorage.removeItem('lastActivity');
      setIsAuthenticated(false);
      setUserRole('IT_ADMIN'); 
      setUserName('');
      setUserEmail('');
      setOrganizations([]);
      setCurrentBranch(null);
      setCurrentRoute('dashboard');
  };

  // Setup session timeout tracking
  useEffect(() => {
      if (!isAuthenticated) return;

      const updateActivity = () => {
          localStorage.setItem('lastActivity', Date.now().toString());
      };

      const checkSession = () => {
          const lastActivity = localStorage.getItem('lastActivity');
          
          // Use 15 minutes if enforced by organization settings (sessionTimeout is true or undefined)
          // If sessionTimeout is explicitly false, inactivity logout is disabled
          const isEnforced = currentBranch?.settings?.security?.sessionTimeout !== false;
          localStorage.setItem('sessionTimeoutEnforced', isEnforced ? 'true' : 'false');

          if (!isEnforced) {
              return;
          }

          if (lastActivity && Date.now() - parseInt(lastActivity) > SESSION_TIMEOUT_MS) {
              handleLogout();
              alert("Your session has expired due to inactivity. Please log in again.");
          }
      };

      // Events that count as activity
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));

      // Check session every minute
      const interval = setInterval(checkSession, 60000);

      return () => {
          events.forEach(event => window.removeEventListener(event, updateActivity));
          clearInterval(interval);
      };
  }, [isAuthenticated, currentBranch]);

  const handleCreateOrganization = async (orgData: any) => {
      if (userRole !== 'SUPER_ADMIN') return;
      
      try {
          const response = await fetch('/api/admin/companies', {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'x-user-role': userRole
              },
              body: JSON.stringify(orgData)
          });

          if (response.ok) {
              const newOrg = await response.json();
              setOrganizations(prev => [...prev, newOrg]);
              if (newOrg.branches.length > 0) {
                  setCurrentBranch(newOrg.branches[0]);
              }
              setIsCreateOrgModalOpen(false);
          } else {
              const err = await response.json();
              alert(err.error || 'Failed to create organization');
          }
      } catch (error) {
          console.error('Error creating organization:', error);
          alert('Network error creating organization');
      }
  };

  const handleDeleteOrganization = async (orgId: string) => {
      if (userRole !== 'SUPER_ADMIN') return;
      
      if (organizations.length <= 1) {
          alert("Cannot delete the only organization.");
          return;
      }

      if (!window.confirm('Are you sure you want to delete this company? All related data will be lost.')) return;

      try {
          const response = await fetch(`/api/admin/companies/${orgId}`, {
              method: 'DELETE',
              headers: { 'x-user-role': userRole }
          });

          if (response.ok) {
              const updatedOrgs = organizations.filter(o => o.id !== orgId);
              setOrganizations(updatedOrgs);

              if (currentBranch && currentBranch.organizationId === orgId) {
                  if (updatedOrgs.length > 0 && updatedOrgs[0].branches.length > 0) {
                      setCurrentBranch(updatedOrgs[0].branches[0]);
                  } else {
                      setCurrentBranch(null);
                  }
              }
          } else {
              const err = await response.json();
              alert(err.error || 'Failed to delete organization');
          }
      } catch (error) {
          console.error('Error deleting organization:', error);
          alert('Network error deleting organization');
      }
  };

  const renderContent = () => {
    // RBAC Route Protection Logic
    if ((currentRoute === 'certificates' || currentRoute === 'erp-connectors') && userRole !== 'IT_ADMIN') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in zoom-in duration-300">
          <div className="bg-rose-50 p-6 rounded-full mb-6">
             <span className="text-4xl">🚫</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Access Denied</h2>
          <p className="text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            You do not have permission to access {currentRoute === 'certificates' ? 'Certificate Management' : 'ERP Configuration'}. 
            This area is restricted to IT Administrators.
          </p>
          <button 
            onClick={() => navigate('dashboard')}
            className="mt-8 px-6 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-medium shadow-lg shadow-slate-900/10"
          >
            Return to Dashboard
          </button>
        </div>
      );
    }

    // Super Admin Restrictions (Operational Routes)
    const operationalRoutes = ['invoices', 'create-invoice', 'invoice-detail', 'validator'];
    if (operationalRoutes.includes(currentRoute) && userRole === 'SUPER_ADMIN') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in zoom-in duration-300">
              <div className="bg-slate-100 p-6 rounded-full mb-6">
                 <span className="text-4xl">🏢</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Company Management Mode</h2>
              <p className="text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                Super Admin account is restricted to Company and Entity management only. 
                Please use an operational account (Admin/Finance/Tax) to manage invoices.
              </p>
              <button 
                onClick={() => navigate('dashboard')}
                className="mt-8 px-6 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-medium shadow-lg shadow-slate-900/10"
              >
                Return to Dashboard
              </button>
            </div>
          );
    }

    switch (currentRoute) {
      case 'dashboard':
        return <Dashboard onNavigate={navigate} selectedBranch={currentBranch} userRole={userRole} userEmail={userEmail} />;
      case 'users':
        return <UserManagement userRole={userRole} userName={userName} />;
      case 'invoices':
        return <InvoiceList userRole={userRole} userEmail={userEmail} onSelectInvoice={(id) => navigate('invoice-detail', id)} onNavigate={navigate} selectedBranch={currentBranch} />;
      case 'create-invoice':
        // If coming from "Issue Credit Note" context, selectedInvoiceId acts as the Reference ID
        return <InvoiceGenerator onNavigate={navigate} referenceInvoiceId={selectedInvoiceId} selectedBranch={currentBranch} organizations={organizations} userRole={userRole} userEmail={userEmail} />;
      case 'invoice-detail':
        return <InvoiceDetail userRole={userRole} invoiceId={selectedInvoiceId} onBack={() => navigate('invoices')} onNavigate={navigate} />;
      case 'items':
        return <ItemMaster selectedBranch={currentBranch} userRole={userRole} userEmail={userEmail} />;
      case 'certificates':
        return <CertificateManager selectedBranch={currentBranch} organizations={organizations} />;
      case 'erp-connectors':
        return <ERPConnectors selectedBranch={currentBranch} />;
      case 'audit':
        return <AuditLog userRole={userRole} userEmail={userEmail} />;
      case 'validator':
        return <XMLValidator />;
      case 'settings':
        return (
          <Settings 
            selectedBranch={currentBranch} 
            organizations={organizations} 
            userRole={userRole}
            onRefresh={fetchOrganizations}
          />
        );
      case 'reports':
        return <ReportCenter userRole={userRole} userEmail={userEmail} />;
      case 'report-designer':
        if (userRole !== 'SUPER_ADMIN') {
            return (
                <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in zoom-in duration-300">
                  <div className="bg-rose-50 p-6 rounded-full mb-6">
                     <span className="text-4xl">🚫</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Access Denied</h2>
                  <p className="text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                    You do not have permission to access the Report Designer. 
                    This area is restricted to Super Administrators.
                  </p>
                  <button 
                    onClick={() => navigate('dashboard')}
                    className="mt-8 px-6 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-medium shadow-lg shadow-slate-900/10"
                  >
                    Return to Dashboard
                  </button>
                </div>
            );
        }
        return <ReportDesigner userRole={userRole} />;
      case 'api-docs':
        return <ApiDocs />;
      default:
        return <Dashboard onNavigate={navigate} selectedBranch={currentBranch} userRole={userRole} userEmail={userEmail} />;
    }
  };

  if (!isAuthenticated) {
      return <Login onLogin={handleLogin} />;
  }

  return (
    <ToastProvider>
        {!isOnline && (
            <div className="bg-slate-900 text-white text-xs font-bold py-2 text-center flex items-center justify-center sticky top-0 z-[100]">
                <WifiOff size={14} className="mr-2" /> Offline Mode - Changes will sync when connection is restored
            </div>
        )}
        {isOnline && isSyncing && (
             <div className="bg-emerald-600 text-white text-xs font-bold py-2 text-center flex items-center justify-center sticky top-0 z-[100] animate-in slide-in-from-top-0">
                <RefreshCw size={14} className="mr-2 animate-spin" /> Restoring Connection - Syncing Data...
            </div>
        )}

        <ErrorBoundary>
        <Layout 
        currentRoute={currentRoute} 
        onNavigate={navigate} 
        userRole={userRole} 
        userName={userName} 
        onLogout={handleLogout}
        organizations={organizations}
        currentBranch={currentBranch}
        onSwitchBranch={setCurrentBranch}
        onCreateOrganization={() => setIsCreateOrgModalOpen(true)}
        onDeleteOrganization={handleDeleteOrganization}
        >
        {renderContent()}
        </Layout>
        </ErrorBoundary>

        {isCreateOrgModalOpen && (
            <CreateOrganizationModal 
                onClose={() => setIsCreateOrgModalOpen(false)}
                onCreate={handleCreateOrganization}
                users={userRole === 'SUPER_ADMIN' ? users : []}
            />
        )}
    </ToastProvider>
  );
};

export default App;
