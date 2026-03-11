import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
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
      <div className="space-y-5">
        <Link
          href="/dashboard/events"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors"
        >
          <ChevronLeft size={15} />
          Events
        </Link>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <h1 className="text-xl font-bold text-slate-800 mb-2">Event Not Found</h1>
          <p className="text-slate-500 text-sm">The event you&apos;re looking for doesn&apos;t exist or has been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <ExclusionManagementPage
      eventId={event._id}
      eventName={event.Event_Name}
      eventUrl={event.URL}
      eventVenue={event.Venue}
      eventDate={event.Event_DateTime}
    />
  );
}