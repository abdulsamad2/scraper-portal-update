import React from 'react';
import Link from 'next/link';
import { getEventById } from '@/actions/eventActions';
import ExclusionManagementPage from '../../../../../components/ExclusionManagementPage';

interface ExclusionPageProps {
  params: Promise<{ id: string }>;
}

interface EventType {
  _id: string;
  mapping_id: string;
  Event_ID: string;
  Event_Name: string;
  Event_DateTime: string;
  Venue?: string;
  URL: string;
  Zone?: string;
  Available_Seats?: number;
  Skip_Scraping?: boolean;
  inHandDate?: string;
  priceIncreasePercentage?: number;
  Last_Updated?: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

export default async function EventExclusionPage({ params }: ExclusionPageProps) {
  const { id } = await params;
  const event: EventType = await getEventById(id) as EventType;

  if (!event || event.error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-6xl mx-auto p-8">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">Event Not Found</h1>
            <p className="text-slate-600 mb-6">
              The event you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
            <Link 
              href="/dashboard/events"
              className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <span>Back to Events</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ExclusionManagementPage 
      eventId={event._id} 
      eventName={event.Event_Name}
    />
  );
}