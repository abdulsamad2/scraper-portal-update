import { getPaginatedOrders, getOrderTabCounts } from '@/actions/orderActions';
import OrdersClient from './OrdersClient';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const [result, tabCounts] = await Promise.all([
    getPaginatedOrders(1, 10000, {
      statusIn: ['invoiced', 'pending', 'problem'],
    }, 'order_date', 'desc'),
    getOrderTabCounts(),
  ]);

  return (
    <OrdersClient
      initialOrders={result.orders}
      initialTabCounts={tabCounts}
      initialUnackCount={result.unacknowledgedCount}
    />
  );
}
