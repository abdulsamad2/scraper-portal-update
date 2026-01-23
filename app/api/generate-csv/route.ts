import { NextRequest, NextResponse } from 'next/server';
import { generateInventoryCsv } from '../../../actions/csvActions';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventUpdateFilterMinutes = 0 } = body;
    
    console.log('Starting manual CSV generation...');
    const result = await generateInventoryCsv(eventUpdateFilterMinutes);
    
    if (result.success) {
      console.log(`Manual CSV generation completed: ${result.recordCount} records in ${result.generationTime}ms`);
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    } else {
      console.error('Manual CSV generation failed:', result.message);
      return NextResponse.json(result, { 
        status: 400,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }
  } catch (error) {
    console.error('Error in manual CSV generation API:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error during CSV generation' 
    }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }
}