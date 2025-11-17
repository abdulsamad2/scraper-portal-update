'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { 
  LayoutDashboard, 
  Calendar, 
  Plus, 
  Menu, 
  Package, 
  Download, 
  LogOut,
  ShoppingCart,
  X,
  Heart,
  SignalHigh
  
} from 'lucide-react';

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleLogout = () => {
    // Clear authentication cookie
    document.cookie = 'authenticated=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // Redirect to login
    router.push('/login');
  };

  const navItems = [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-5 h-5" />,
      isActive: true,
    },
    {
      path: '/dashboard/events',
      label: 'Events',
      icon: <Calendar className="w-5 h-5" />,
      isActive: true,
    },
    {
      path: '/dashboard/inventory',
      label: 'Inventory',
      icon: <Package className="w-5 h-5" />,
      isActive: true,
    },
    {
      path: '/dashboard/list-event',
      label: 'Add Event',
      icon: <Plus className="w-5 h-5" />,
      isActive: true,
    },
    {
      path: '/dashboard/export-csv',
      label: 'Export CSV',
      icon: <Download className="w-5 h-5" />,
      isActive: true,
    },
  ];

  const comingSoonItems = [
    {
      label: 'Orders',
      icon: <ShoppingCart className="w-5 h-5" />,
      description: 'Manage customer orders'
    },
     {
      label: 'Proxies',
      icon: <SignalHigh className="w-5 h-5" />,
      description: 'Manage Proxies'
    },
  ];
  

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Sidebar */}
      <aside className={`bg-white w-72 max-w-[90vw] min-h-screen shadow-xl transition-all duration-300 ease-in-out border-r border-slate-200 overflow-hidden ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } fixed lg:relative lg:translate-x-0 z-50`}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-200 flex-shrink-0">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent truncate">
                TMC Portal
              </h1>
            </div>
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors lg:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <nav className="space-y-2 min-w-0">
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-3 truncate">
                  Main Navigation
                </h3>
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`flex items-center gap-3 p-3 rounded-xl mb-1 transition-all duration-200 group min-w-0 ${
                      pathname === item.path
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25'
                        : 'hover:bg-slate-50 text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    <span className={`transition-transform duration-200 flex-shrink-0 ${
                      pathname === item.path ? 'scale-110' : 'group-hover:scale-105'
                    }`}>
                      {item.icon}
                    </span>
                    <span className="font-medium truncate flex-1 min-w-0">{item.label}</span>
                  </Link>
                ))}

                {/* Coming Soon Items */}
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 px-3 truncate">
                    Coming Soon
                  </h4>
                  {comingSoonItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-xl text-slate-400 cursor-not-allowed mb-1 min-w-0"
                    >
                      <span className="opacity-60 flex-shrink-0">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm truncate block">{item.label}</span>
                      </div>
                      <span className="text-xs bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-1 rounded-full font-medium flex-shrink-0 whitespace-nowrap">
                        Soon
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </nav>
          </div>

          {/* Logout Button */}
          <div className="p-4 border-t border-slate-200 flex-shrink-0">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-red-50 hover:text-red-600 w-full text-left text-slate-700 group min-w-0"
            >
              <LogOut className="w-5 h-5 transition-transform duration-200 group-hover:scale-105 flex-shrink-0" />
              <span className="font-medium truncate">Logout</span>
            </button>
            
            {/* Made with Love Footer */}
            <div className="mt-4 pt-4 border-t border-slate-100 text-center">
              <p className="text-xs text-slate-400">Made by a hidden programmer in dark mode 🌙</p>
              <p className="text-xs text-slate-400">Light mode not supported.</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsSidebarOpen(true)}
        className={`fixed top-4 left-4 z-30 p-2 bg-white rounded-lg shadow-lg lg:hidden transition-transform duration-300 ${
          isSidebarOpen ? 'scale-0' : 'scale-100'
        }`}
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto main-content">
        <div className="p-6 lg:p-8 min-w-0">
          {children}
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
