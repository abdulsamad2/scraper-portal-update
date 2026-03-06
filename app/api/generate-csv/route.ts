import { NextRequest } from 'next/server';
import { generateInventoryCsvStream } from '../../../actions/csvActions';

// Allow up to 5 minutes for large CSV generation
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventUpdateFilterMinutes = 0 } = body;

    console.log('Starting streaming CSV generation...');

    const encoder = new TextEncoder();
    let hasData = false;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of generateInventoryCsvStream(eventUpdateFilterMinutes)) {
            if (chunk.type === 'header' || chunk.type === 'data') {
              if (chunk.text) {
                hasData = true;
                controller.enqueue(encoder.encode(chunk.text));
              }
            } else if (chunk.type === 'done') {
              if (chunk.error && !hasData) {
                controller.enqueue(encoder.encode(`ERROR: ${chunk.error}`));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    // We must set headers before streaming starts — use trailer-like approach
    // by embedding metadata in custom headers. Record count won't be exact
    // in headers (set before streaming), so client reads from trailer comment or uses what it gets.
    const headers = new Headers();
    headers.set('Content-Type', 'text/csv; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="inventory-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv"`);
    headers.set('Transfer-Encoding', 'chunked');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error('Error in streaming CSV generation API:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error during CSV generation' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
