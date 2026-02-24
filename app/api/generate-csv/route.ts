import { NextRequest, NextResponse } from 'next/server';
import { generateInventoryCsv } from '../../../actions/csvActions';

// Allow up to 5 minutes for large CSV generation
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventUpdateFilterMinutes = 0 } = body;
    
    console.log('Starting manual CSV generation...');
    const result = await generateInventoryCsv(eventUpdateFilterMinutes);
    
    if (result.success && result.csv) {
      console.log(`Manual CSV generation completed: ${result.recordCount} records in ${result.generationTime}ms`);
      
      // Return CSV directly as a file download instead of wrapping in JSON
      const headers = new Headers();
      headers.set('Content-Type', 'text/csv; charset=utf-8');
      headers.set('Content-Disposition', `attachment; filename="inventory-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv"`);
      headers.set('X-Record-Count', String(result.recordCount || 0));
      headers.set('X-Generation-Time', String(result.generationTime || 0));
      headers.set('X-Excluded-Count', String(result.excludedCount || 0));
      
      return new Response(result.csv, { status: 200, headers });
    } else {
      console.error('Manual CSV generation failed:', result.message);
      return NextResponse.json({ 
        success: false, 
        message: result.message || 'Failed to generate CSV' 
      }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in manual CSV generation API:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error during CSV generation' 
    }, { status: 500 });
  }
}