import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';

export const dynamic = 'force-dynamic';

/**
 * Ultra-lightweight poll endpoint — single aggregate query.
 * No external API calls, no writes. Returns counts + a hash for change detection.
 */
export async function GET() {
  try {
    await dbConnect();

    // Single aggregate does everything: status counts, unack counts, flagged count
    const pipeline = await Order.aggregate([
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
          unackInvoiced: [
            { $match: { acknowledged: false, status: { $in: ['invoiced', 'pending'] } } },
            { $count: 'count' },
          ],
          unackProblem: [
            { $match: { acknowledged: false, status: 'problem' } },
            { $count: 'count' },
          ],
          flagged: [
            { $match: { hasIssue: true, status: { $in: ['invoiced', 'pending', 'problem'] } } },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const { byStatus, total: totalArr, unackInvoiced, unackProblem, flagged } = pipeline[0];
    const sc: Record<string, number> = {};
    for (const s of byStatus) sc[s._id] = s.count;

    const unacknowledgedCount = unackInvoiced[0]?.count || 0;
    const unacknowledgedProblemCount = unackProblem[0]?.count || 0;

    const tabCounts = {
      invoiced: (sc.invoiced || 0) + (sc.pending || 0),
      problem: sc.problem || 0,
      confirmed: (sc.confirmed || 0) + (sc.confirmed_delay || 0),
      rejected: sc.rejected || 0,
      deliveryIssue: sc.delivery_problem || 0,
      delivered: sc.delivered || 0,
      all: totalArr[0]?.count || 0,
      flagged: flagged[0]?.count || 0,
    };

    // Hash for quick change detection — client can skip refresh if hash unchanged
    const hash = `${unacknowledgedCount}:${unacknowledgedProblemCount}:${tabCounts.invoiced}:${tabCounts.problem}:${tabCounts.confirmed}:${tabCounts.delivered}:${tabCounts.all}:${tabCounts.flagged}`;

    return NextResponse.json({
      unacknowledgedCount,
      unacknowledgedProblemCount,
      tabCounts,
      hash,
    });
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
