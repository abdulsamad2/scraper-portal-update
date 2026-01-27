'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAllEvents } from '@/actions/eventActions';
import { getConsecutiveGroupsPaginated } from '@/actions/seatActions';
import { 
  Calendar,
  Package,
  Activity,
  ArrowUpRight,
  TrendingUp,
  Plus,
  Download,
  BarChart3,
  MousePointer2
} from 'lucide-react';

// Force dynamic rendering to ensure fresh data
export const dynamic = 'force-dynamic';

// Client-side time component to avoid hydration mismatch (rendering-hydration-no-flicker)
function ClientTime() {
  const [time, setTime] = useState(() => {
    // Lazy initialization to avoid computation on every render (rerender-lazy-state-init)
    if (typeof window === 'undefined') return '--:--:--';
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit', 
      second: '2-digit',
      hour12: false
    }).format(new Date());
  });

  useEffect(() => {
    const updateTime = () => {
      setTime(new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(new Date()));
    };
    
    const interval = setInterval(updateTime, 1000);
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array as per rerender-dependencies rule

  return <span>{time}</span>;
}

interface EventDoc {
  Event_DateTime: string;
  _id: string;
  Event_Name: string;
  Venue?: string;
  createdAt: string;
  Available_Seats?: number;
  Skip_Scraping?: boolean; // Add this field
  // add more fields if needed
}

interface DashboardStats {
  totalEvents: number;
  totalSeats: number;
  activeScrapingCount: number; // Add this new field
  recentEvents: EventDoc[];
  weeklyEventsData: { day: string; count: number; seats: number }[];
  loading: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  // Lazy state initialization to avoid expensive computation on every render (rerender-lazy-state-init)
  const [stats, setStats] = useState<DashboardStats>(() => ({
    totalEvents: 0,
    totalSeats: 0,
    activeScrapingCount: 0,
    recentEvents: [],
    weeklyEventsData: [],
    loading: true,
  }));

  const [chartMode, setChartMode] = useState<'time' | 'scatter'>('time');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Use Promise.all for parallel data fetching (async-parallel)
        const [eventsData, seatsData] = await Promise.all([
          getAllEvents(),
          getConsecutiveGroupsPaginated(1000, 1, '', {}) // Get first 1000 records to get total
        ]);

        // Check if any of these returned an error
        if (!Array.isArray(eventsData) || 'error' in seatsData) {
          throw new Error("Error fetching dashboard data");
        }

        // Calculate active scraping count (events where Skip_Scraping is false or undefined)
        const activeScrapingCount = Array.isArray(eventsData) 
          ? eventsData.filter(
              (event): event is EventDoc =>
                typeof event === 'object' &&
                event !== null &&
                'Skip_Scraping' in event
            ).filter(event => !event.Skip_Scraping).length
          : 0;

        // Calculate weekly events data
        const weeklyData = Array.isArray(eventsData) && eventsData.length > 0 && eventsData.every((event): event is EventDoc => 
          typeof event === 'object' &&
          'Event_DateTime' in event &&
          '_id' in event &&
          'Event_Name' in event &&
          'createdAt' in event)
          ? calculateWeeklyEvents(eventsData)
          : [];

        setStats({
          totalEvents: Array.isArray(eventsData) ? eventsData.length : 0,
          totalSeats: seatsData.totalQuantity || 0,
          activeScrapingCount, // Set the calculated value
          weeklyEventsData: weeklyData,
          recentEvents: Array.isArray(eventsData) && eventsData.length > 0 && eventsData.every((event): event is EventDoc => 
            typeof event === 'object' &&
            'Event_DateTime' in event &&
            '_id' in event &&
            'Event_Name' in event &&
            'createdAt' in event)
            ? eventsData
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 5)
            : [],
          loading: false,
        });
      } catch (err) {
        console.error("Error loading dashboard data:", err);
        setStats(prev => ({ ...prev, loading: false }));
      }
    }

    fetchData();
  }, []);

  // Calculate events created in the last 7 days
  const calculateWeeklyEvents = (events: EventDoc[]) => {
    const today = new Date();
    const weekData = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      
      const eventsOnDay = events.filter(event => {
        const eventDate = new Date(event.createdAt);
        return eventDate.toDateString() === date.toDateString();
      });
      
      // Calculate total seats for events created on this day
      const totalSeatsOnDay = eventsOnDay.reduce((sum, event) => {
        return sum + (event.Available_Seats || 0);
      }, 0);
      
      weekData.push({ 
        day: dayName, 
        count: eventsOnDay.length,
        seats: totalSeatsOnDay
      });
    }
    
    return weekData;
  };

  // Format date
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    return new Date(dateString).toLocaleDateString('en-US', options);
  };

  // Handle quick actions
  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'add-event':
        router.push('/dashboard/list-event');
        break;
      case 'manage-inventory':
        router.push('/dashboard/inventory');
        break;
      case 'export-data':
        router.push('/dashboard/export-csv');
        break;
      case 'view-all-events':
        router.push('/dashboard/events');
        break;
      default:
        console.log('Unknown action:', action);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-slate-600 mt-2">
            Welcome back! Here&apos;s what&apos;s happening with your events and inventory.
          </p>
        </div>
        <div className="mt-4 lg:mt-0">
          <div className="text-sm text-slate-500">
            Last updated: <ClientTime />
          </div>
        </div>
      </div>
      
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Events Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Total Events</p>
              <div className="text-3xl font-bold text-slate-800">
                {stats.loading ? (
                  <div className="w-16 h-8 bg-slate-200 rounded animate-pulse"></div>
                ) : (
                  stats.totalEvents.toLocaleString()
                )}
              </div>
              <div className="flex items-center mt-2 text-sm">
                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-green-600 font-medium">
                  {stats.weeklyEventsData.reduce((sum, day) => sum + day.count, 0)}
                </span>
                <span className="text-slate-500 ml-1">this week</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Calendar className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        {/* Total Seats Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Total Inventory</p>
              <div className="text-3xl font-bold text-slate-800">
                {stats.loading ? (
                  <div className="w-16 h-8 bg-slate-200 rounded animate-pulse"></div>
                ) : (
                  stats.totalSeats.toLocaleString()
                )}
              </div>
              <div className="flex items-center mt-2 text-sm">
                <Package className="w-4 h-4 text-emerald-500 mr-1" />
                <span className="text-emerald-600 font-medium">Seats</span>
                <span className="text-slate-500 ml-1">available</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
              <Package className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        {/* Active Scraping Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Active Scraping</p>
              <div className="text-3xl font-bold text-slate-800">
                {stats.loading ? (
                  <div className="w-16 h-8 bg-slate-200 rounded animate-pulse"></div>
                ) : (
                  stats.activeScrapingCount.toLocaleString()
                )}
              </div>
              <div className="flex items-center mt-2 text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                <span className="text-green-600 font-medium">
                  {stats.loading ? 'Loading...' : 'Active'}
                </span>
                <span className="text-slate-500 ml-1">
                  {stats.activeScrapingCount === 1 ? 'event' : 'events'}
                </span>
              </div>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Events Chart & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Weekly Events & Seats Trends Chart */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Weekly Trends</h3>
                <p className="text-sm text-slate-500 mt-1">Events and seats data from past 7 days</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-slate-100 rounded-lg p-1">
                  <button
                    onClick={() => setChartMode('time')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      chartMode === 'time'
                        ? 'bg-white text-slate-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <BarChart3 className="w-3 h-3 mr-1 inline" />
                    Timeline
                  </button>
                  <button
                    onClick={() => setChartMode('scatter')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      chartMode === 'scatter'
                        ? 'bg-white text-slate-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MousePointer2 className="w-3 h-3 mr-1 inline" />
                    Scatter
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"></div>
                  <span className="text-sm text-slate-600">Events</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"></div>
                  <span className="text-sm text-slate-600">Seats</span>
                </div>
              </div>
            </div>
            
            {stats.loading ? (
              <div className="space-y-4">
                <div className="animate-pulse">
                  <div className="flex items-end space-x-3 h-64">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => {
                      // Fixed heights to prevent hydration mismatch
                      const heights = [
                        [80, 120], [95, 140], [70, 100], [110, 160],
                        [85, 130], [75, 110], [90, 150]
                      ];
                      const [height1, height2] = heights[i - 1];
                      return (
                        <div key={i} className="flex-1 space-y-2">
                          <div className="bg-slate-200 rounded-t" style={{ height: `${height1}px` }}></div>
                          <div className="bg-slate-200 rounded-t" style={{ height: `${height2}px` }}></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : chartMode === 'time' ? (
              <div className="space-y-6">
                <div className="relative">
                  {/* Y-axis labels */}
                  <div className="absolute left-0 top-0 bottom-16 w-8 flex flex-col justify-between text-xs text-slate-400">
                    <span>{Math.max(...stats.weeklyEventsData.map(d => Math.max(d.count, d.seats)))}</span>
                    <span>{Math.floor(Math.max(...stats.weeklyEventsData.map(d => Math.max(d.count, d.seats))) / 2)}</span>
                    <span>0</span>
                  </div>
                  
                  {/* Chart area */}
                  <div className="ml-10 border-l border-b border-slate-200">
                    <div className="flex items-end space-x-3 h-64 px-4 pb-2">
                      {stats.weeklyEventsData.map((day, index) => {
                        const maxValue = Math.max(...stats.weeklyEventsData.map(d => Math.max(d.count, d.seats)), 1);
                        const eventsHeight = (day.count / maxValue) * 240;
                        const seatsHeight = (day.seats / maxValue) * 240;
                        const isHovered = hoveredBar === index;
                        
                        return (
                          <div 
                            key={index} 
                            className="flex-1 flex flex-col items-center relative group cursor-pointer"
                            onMouseEnter={() => setHoveredBar(index)}
                            onMouseLeave={() => setHoveredBar(null)}
                          >
                            <div className="w-full flex space-x-1 items-end relative">
                              {/* Events Bar */}
                              <div 
                                className={`flex-1 bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-lg transition-all duration-300 relative ${
                                  isHovered ? 'from-blue-600 to-blue-500 shadow-lg scale-105' : 'hover:from-blue-600 hover:to-blue-500'
                                }`}
                                style={{ height: `${Math.max(eventsHeight, 8)}px` }}
                              >
                                {isHovered && (
                                  <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-10 whitespace-nowrap">
                                    <div className="font-semibold">{day.count} Events</div>
                                    <div className="text-slate-300">{day.day}</div>
                                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Seats Bar */}
                              <div 
                                className={`flex-1 bg-gradient-to-t from-emerald-500 to-emerald-400 rounded-t-lg transition-all duration-300 relative ${
                                  isHovered ? 'from-emerald-600 to-emerald-500 shadow-lg scale-105' : 'hover:from-emerald-600 hover:to-emerald-500'
                                }`}
                                style={{ height: `${Math.max(seatsHeight, 8)}px` }}
                              >
                                {isHovered && (
                                  <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-10 whitespace-nowrap">
                                    <div className="font-semibold">{day.seats.toLocaleString()} Seats</div>
                                    <div className="text-slate-300">{day.day}</div>
                                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="mt-3 text-center">
                              <div className={`text-xs font-medium transition-colors ${isHovered ? 'text-slate-800' : 'text-slate-600'}`}>
                                {day.day}
                              </div>
                              <div className="text-xs text-slate-400 mt-1">
                                {day.count}E · {day.seats}S
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* X-axis label */}
                    <div className="text-center mt-2 text-xs font-medium text-slate-500">
                      Days of the Week
                    </div>
                  </div>
                  
                  {/* Y-axis label */}
                  <div className="absolute -left-8 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs font-medium text-slate-500 whitespace-nowrap">
                    Count
                  </div>
                </div>
                
                {/* Summary Stats */}
                <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {stats.weeklyEventsData.reduce((sum, day) => sum + day.count, 0)}
                      </div>
                      <div className="text-sm text-slate-600">Total Events This Week</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-emerald-600">
                        {stats.weeklyEventsData.reduce((sum, day) => sum + day.seats, 0).toLocaleString()}
                      </div>
                      <div className="text-sm text-slate-600">Total Seats Added</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Scatter plot view: Events vs Seats
              <div className="space-y-6">
                <div className="relative">
                  {/* Y-axis labels */}
                  <div className="absolute left-0 top-0 bottom-16 w-12 flex flex-col justify-between text-xs text-slate-400">
                    <span>{Math.max(...stats.weeklyEventsData.map(d => d.seats))}</span>
                    <span>{Math.floor(Math.max(...stats.weeklyEventsData.map(d => d.seats)) / 2)}</span>
                    <span>0</span>
                  </div>
                  
                  {/* Chart area */}
                  <div className="ml-14 border-l border-b border-slate-200 relative">
                    <div className="h-64 p-4 relative">
                      {stats.weeklyEventsData.map((day, index) => {
                        const maxEvents = Math.max(...stats.weeklyEventsData.map(d => d.count), 1);
                        const maxSeats = Math.max(...stats.weeklyEventsData.map(d => d.seats), 1);
                        const x = (day.count / maxEvents) * 90; // 90% of width for positioning
                        const y = (day.seats / maxSeats) * 90; // 90% of height for positioning
                        const isHovered = hoveredBar === index;
                        
                        return (
                          <div
                            key={index}
                            className={`absolute w-6 h-6 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full cursor-pointer transition-all duration-300 ${
                              isHovered ? 'scale-150 shadow-lg from-purple-600 to-purple-700' : 'hover:scale-125'
                            }`}
                            style={{
                              left: `${x}%`,
                              bottom: `${y}%`,
                              transform: 'translate(-50%, 50%)'
                            }}
                            onMouseEnter={() => setHoveredBar(index)}
                            onMouseLeave={() => setHoveredBar(null)}
                          >
                            {isHovered && (
                              <div className="absolute -top-16 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-10 whitespace-nowrap">
                                <div className="font-semibold">{day.day}</div>
                                <div className="text-slate-300">{day.count} Events</div>
                                <div className="text-slate-300">{day.seats} Seats</div>
                                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800"></div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* X-axis label */}
                    <div className="text-center mt-2 text-xs font-medium text-slate-500">
                      Number of Events
                    </div>
                  </div>
                  
                  {/* Y-axis label */}
                  <div className="absolute -left-10 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs font-medium text-slate-500 whitespace-nowrap">
                    Number of Seats
                  </div>
                </div>
                
                {/* Scatter plot explanation */}
                <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-xl p-4">
                  <div className="text-center">
                    <div className="text-sm font-medium text-purple-800 mb-2">
                      Events vs Seats Correlation
                    </div>
                    <div className="text-xs text-purple-600">
                      Each point represents a day of the week. Position shows the relationship between number of events created and total seats added.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <button 
                onClick={() => handleQuickAction('add-event')}
                className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 rounded-xl transition-all duration-200 group hover:shadow-md"
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center mr-3 group-hover:bg-blue-600 transition-colors">
                    <Plus className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-medium text-slate-700">Add New Event</span>
                </div>
                <ArrowUpRight className="w-5 h-5 text-blue-500 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-200" />
              </button>
              
              <button 
                onClick={() => handleQuickAction('manage-inventory')}
                className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-emerald-50 to-green-50 hover:from-emerald-100 hover:to-green-100 rounded-xl transition-all duration-200 group hover:shadow-md"
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center mr-3 group-hover:bg-emerald-600 transition-colors">
                    <Package className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-medium text-slate-700">Manage Inventory</span>
                </div>
                <ArrowUpRight className="w-5 h-5 text-emerald-500 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-200" />
              </button>
              
              <button 
                onClick={() => handleQuickAction('export-data')}
                className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-violet-50 hover:from-purple-100 hover:to-violet-100 rounded-xl transition-all duration-200 group hover:shadow-md"
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center mr-3 group-hover:bg-purple-600 transition-colors">
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-medium text-slate-700">Export Data</span>
                </div>
                <ArrowUpRight className="w-5 h-5 text-purple-500 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-200" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Events */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-slate-800">Recent Events</h3>
          <button 
            onClick={() => handleQuickAction('view-all-events')}
            className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center transition-colors duration-200 hover:bg-blue-50 px-3 py-1 rounded-lg"
          >
            View All
            <ArrowUpRight className="w-4 h-4 ml-1" />
          </button>
        </div>
        
        {stats.loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-slate-200 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : stats.recentEvents.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">No recent events</p>
            <p className="text-slate-400 text-sm">Events will appear here once you add them</p>
          </div>
        ) : (
          <div className="space-y-4">
            {stats.recentEvents.map((event) => (
              <div key={event._id} className="flex items-center space-x-4 p-4 hover:bg-slate-50 rounded-xl transition-colors duration-200">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-800 truncate">{event.Event_Name}</h4>
                  <div className="flex items-center space-x-4 mt-1">
                    <span className="text-sm text-slate-500">{event.Venue || 'N/A'}</span>
                    <span className="text-sm text-slate-400">•</span>
                    <span className="text-sm text-slate-500">
                      {event.Event_DateTime ? formatDate(event.Event_DateTime) : 'N/A'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-800">{event.Available_Seats || 0} seats</div>
                  <div className="text-xs text-slate-400">available</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
