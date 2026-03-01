import { NextRequest, NextResponse } from 'next/server';
import { findVividSeatsMappingId } from '@/lib/vividseats';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const eventName = sp.get('eventName');
    const eventDate = sp.get('eventDate');
    const venueName = sp.get('venueName');

    if (!eventName || !eventDate) {
      return NextResponse.json(
        { error: 'eventName and eventDate are required' },
        { status: 400 }
      );
    }

    const { result, failReason, searchTermUsed } = await findVividSeatsMappingId(
      eventName,
      eventDate,
      venueName || ''
    );

    if (result) {
      return NextResponse.json({
        success: true,
        productionId: result.productionId,
        productionName: result.productionName,
        venueName: result.venueName,
      });
    }

    return NextResponse.json({
      success: false,
      message: failReason || 'No matching Vivid Seats event found',
      searchTermUsed: searchTermUsed || '',
    });
  } catch (error) {
    console.error('Vivid Seats lookup error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Lookup failed' },
      { status: 500 }
    );
  }
}
