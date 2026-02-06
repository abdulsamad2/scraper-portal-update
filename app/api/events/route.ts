import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';

export async function GET(request: Request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '1000');
    const search = searchParams.get('search') || '';
    
    // Build search filter
    const filter: any = {};
    if (search) {
      filter.$or = [
        { Event_Name: { $regex: search, $options: 'i' } },
        { Venue: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Calculate skip value
    const skip = (page - 1) * limit;
    
    // Get total count for pagination
    const total = await Event.countDocuments(filter);
    
    // Get events with pagination
    const events = await Event.find(filter, {
      mapping_id: 1,
      Event_Name: 1,
      Event_DateTime: 1,
      Venue: 1,
      Available_Seats: 1,
      Skip_Scraping: 1,
      Last_Updated: 1
    })
    .sort({ Event_DateTime: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

    // Return paginated response
    if (limit >= 1000) {
      // For backwards compatibility - return all events if limit is high
      return NextResponse.json(events);
    } else {
      // Return paginated response
      return NextResponse.json({
        events,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    }
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}