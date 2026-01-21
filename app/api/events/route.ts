import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';

export async function GET() {
  try {
    await dbConnect();
    
    const events = await Event.find({}, {
      mapping_id: 1,
      Event_Name: 1,
      Event_DateTime: 1,
      Venue: 1,
      Available_Seats: 1,
      Skip_Scraping: 1,
      Last_Updated: 1
    })
    .sort({ Event_DateTime: -1 })
    .limit(1000) // Reasonable limit for the UI
    .lean();

    return NextResponse.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}