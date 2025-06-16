'use client';

import { useEffect, useState } from 'react';
import { getAllEvents } from '@/actions/eventActions';
import { getAllConsecutiveGroups } from '@/actions/seatActions';
import { getAllErrorLogs } from '@/actions/errorLogActions';
import { TicketIcon, AlertTriangle, Clock } from 'lucide-react';

interface EventDoc {
  Event_DateTime: string;
  _id: string;
  Event_Name: string;
  Venue?: string;
  createdAt: string;
  Available_Seats?: number;
  // add more fields if needed
}

interface DashboardStats {
  totalEvents: number;
  totalSeats: number;
  totalErrors: number;
  recentEvents: EventDoc[];
  loading: boolean;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalEvents: 0,
    totalSeats: 0,
    totalErrors: 0,
    recentEvents: [],
    loading: true,
  });

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch summary data
        const eventsData = await getAllEvents();
        const seatsData = await getAllConsecutiveGroups();
        const errorsData = await getAllErrorLogs({}, { createdAt: -1 }, 10, 0);

        // Check if any of these returned an error
        if (!Array?.isArray(eventsData) || !Array.isArray(seatsData) || !errorsData.totalLogs) {
          throw new Error("Error fetching dashboard data");
        }

        setStats({
          totalEvents: Array.isArray(eventsData) ? eventsData.length : 0,
          totalSeats: Array.isArray(seatsData) ? seatsData.length : 0,
          totalErrors: errorsData.totalLogs || 0,
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

  // Format date
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    return new Date(dateString).toLocaleDateString('en-US', options);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white shadow-md rounded-lg p-6 flex items-center space-x-4">
          <div className="bg-blue-100 p-3 rounded-full">
            <TicketIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Events</p>
            <p className="text-2xl font-bold">
              {stats.loading ? '...' : stats.totalEvents.toLocaleString()}
            </p>
          </div>
        </div>
        
        <div className="bg-white shadow-md rounded-lg p-6 flex items-center space-x-4">
          <div className="bg-green-100 p-3 rounded-full">
            <Clock className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Seats</p>
            <p className="text-2xl font-bold">
              {stats.loading ? '...' : stats.totalSeats.toLocaleString()}
            </p>
          </div>
        </div>
        
        <div className="bg-white shadow-md rounded-lg p-6 flex items-center space-x-4">
          <div className="bg-red-100 p-3 rounded-full">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total Errors</p>
            <p className="text-2xl font-bold">
              {stats.loading ? '...' : stats.totalErrors.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
      
      {/* Recent Events */}
      <div className="bg-white shadow-md rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Events</h2>
        {stats.loading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : stats.recentEvents.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No events found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Venue
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Available Seats
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stats.recentEvents.map((event) => (
                  <tr key={event._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{event.Event_Name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">{event.Venue || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {event.Event_DateTime ? formatDate(event.Event_DateTime) : 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{event.Available_Seats || 0}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
