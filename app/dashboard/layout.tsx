'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutDashboard, Calendar, Play, List, Package, FileText } from 'lucide-react';

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const navItems = [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      path: '/dashboard/events',
      label: 'Events',
      icon: <Calendar className="w-5 h-5" />,
    },
    {
      path: '/dashboard/inventory',
      label: 'Inventory',
      icon: <Package className="w-5 h-5" />,
    },
    {
      path: '/dashboard/list-event',
      label: 'Add Event',
      icon: <Play className="w-5 h-5" />,
    },
    {
      path: '/dashboard/export-csv',
      label: 'Export CSV',
      icon: <FileText className="w-5 h-5" />,
    },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className={`bg-white w-64 min-h-screen p-4 shadow-lg transition-all ${isSidebarOpen ? '' : '-ml-64'}`}>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-bold">Ticket Scraper</h1>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <List className="w-6 h-6" />
          </button>
        </div>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3 p-3 rounded-lg mb-2 transition-colors ${
                pathname === item.path
                  ? 'bg-blue-50 text-blue-600'
                  : 'hover:bg-gray-50'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
