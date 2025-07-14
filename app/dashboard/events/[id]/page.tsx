import React from 'react';
import Link from 'next/link';
import { getEventById } from '@/actions/eventActions';
import { Calendar, MapPin, ExternalLink, Edit, Clock, Users, TrendingUp, Activity } from 'lucide-react';

interface EventDetailsProps {
  params: Promise<{ id: string }>;
}

export default async function EventDetailsPage({ params }: EventDetailsProps) {
  const { id } = await params;
  const event: any = await getEventById(id);

  if (!event || event.error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-6xl mx-auto p-8">
          <Link 
            href="/dashboard/events" 
            className="inline-flex items-center text-slate-600 hover:text-blue-600 transition-colors mb-6"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Events
          </Link>
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Event not found</h1>
            <p className="text-slate-600">The event you're looking for doesn't exist or has been removed.</p>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isStale = event.Last_Updated 
    ? Date.now() - new Date(event.Last_Updated).getTime() > 4 * 60 * 1000
    : true;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link 
            href="/dashboard/events" 
            className="inline-flex items-center text-slate-600 hover:text-blue-600 transition-colors font-medium"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Events
          </Link>
          <Link
            href={`/dashboard/events/${id}/edit`}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
          >
            <Edit size={16} />
            Edit Event
          </Link>
        </div>

        {/* Event Header Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden backdrop-blur-sm">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-8 text-white relative overflow-hidden">
            <div className="relative flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-4xl font-bold mb-3 text-white drop-shadow-sm">
                  {event.Event_Name || 'Event Details'}
                </h1>
                <div className="flex flex-wrap items-center gap-6 text-blue-100">
                  {event.Venue && (
                    <div className="flex items-center gap-2">
                      <MapPin size={16} />
                      <span className="font-medium">{event.Venue}</span>
                    </div>
                  )}
                  {event.Event_DateTime && (
                    <div className="flex items-center gap-2">
                      <Calendar size={16} />
                      <span className="font-medium">{formatDate(event.Event_DateTime)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${
                  event.Skip_Scraping 
                    ? 'bg-red-500/20 text-red-100 border border-red-400/30' 
                    : 'bg-green-500/20 text-green-100 border border-green-400/30'
                }`}>
                  <Activity size={16} />
                  {event.Skip_Scraping ? 'Inactive' : 'Active'}
                </div>
                {isStale && (
                  <div className="mt-3 text-xs text-orange-200">
                    ⚠ Data may be stale
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Event Information */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-8 hover:shadow-2xl transition-all duration-300">
              <h2 className="text-2xl font-bold text-slate-800 mb-8 flex items-center gap-3 pb-2 border-b border-slate-200">
                <Calendar className="text-blue-600" size={24} />
                Event Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Event ID</label>
                  <div className="font-mono text-sm text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {event.Event_ID || '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Event Date & Time</label>
                  <div className="text-slate-800">
                    {event.Event_DateTime ? (
                      <div>
                        <div className="font-bold text-lg">{formatDate(event.Event_DateTime)}</div>
                        <div className="text-sm text-slate-600 font-medium">{formatTime(event.Event_DateTime)}</div>
                      </div>
                    ) : '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Venue</label>
                  <div className="text-slate-800 font-semibold">
                    {event.Venue || '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Event URL</label>
                  <div>
                    {event.URL ? (
                      <a 
                        href={event.URL} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        <ExternalLink size={16} />
                        <span className="truncate max-w-xs">View Event</span>
                      </a>
                    ) : '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Zone</label>
                  <div className="text-slate-800">
                    {event.Zone || 'none'}
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Details */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-8 hover:shadow-2xl transition-all duration-300">
              <h2 className="text-2xl font-bold text-slate-800 mb-8 flex items-center gap-3 pb-2 border-b border-slate-200">
                <svg className="text-blue-600" width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Technical Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">MongoDB ID</label>
                  <div className="font-mono text-xs text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200 break-all">
                    {event._id}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mapping ID</label>
                  <div className="font-mono text-sm text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {event.mapping_id || '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Created At</label>
                  <div className="text-slate-800">
                    {event.createdAt ? new Date(event.createdAt).toLocaleString() : '—'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Last Updated</label>
                  <div className="text-slate-800">
                    {event.updatedAt ? new Date(event.updatedAt).toLocaleString() : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Stats & Status */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300">
              <h3 className="text-xl font-bold text-slate-800 mb-6 pb-2 border-b border-slate-200">Quick Stats</h3>
              <div className="space-y-4">
                <div className="p-5 bg-blue-50 rounded-xl">
                  <div className="flex items-center gap-4">
                    <Users className="text-blue-600" size={24} />
                    <div>
                      <div className="text-sm font-medium text-slate-600">Available Seats</div>
                      <div className="text-3xl font-bold text-slate-800">
                        {(event.Available_Seats ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="p-5 bg-green-50 rounded-xl">
                  <div className="flex items-center gap-4">
                    <TrendingUp className="text-green-600" size={24} />
                    <div>
                      <div className="text-sm font-medium text-slate-600">Price Increase</div>
                      <div className="text-3xl font-bold text-slate-800">
                        {event.priceIncreasePercentage ?? 25}%
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-5 bg-purple-50 rounded-xl">
                  <div className="flex items-center gap-4">
                    <Clock className="text-purple-600" size={24} />
                    <div>
                      <div className="text-sm font-medium text-slate-600">In Hand Date</div>
                      <div className="text-lg font-bold text-slate-800">
                        {event.inHandDate ? new Date(event.inHandDate).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300">
              <h3 className="text-xl font-bold text-slate-800 mb-6 pb-2 border-b border-slate-200">Status Overview</h3>
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Scraping Status</span>
                  <span className={`px-4 py-2 rounded-full text-sm font-bold ${
                    event.Skip_Scraping 
                      ? 'bg-red-100 text-red-800' 
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {event.Skip_Scraping ? 'Inactive' : 'Active'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Data Freshness</span>
                  <span className={`px-4 py-2 rounded-full text-sm font-bold ${
                    isStale 
                      ? 'bg-orange-100 text-orange-800' 
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {isStale ? 'Stale' : 'Fresh'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Zone</span>
                  <span className="px-4 py-2 bg-slate-100 text-slate-800 rounded-full text-sm font-bold">
                    {event.Zone || 'none'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
