import { getPaginatedOrders, getOrderTabCounts } from '@/actions/orderActions';
import OrdersClient from './OrdersClient';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const perPage = 20;
  const [result, tabCounts] = await Promise.all([
    getPaginatedOrders(1, perPage, {
      statusIn: ['invoiced', 'pending', 'problem'],
    }, 'order_date', 'desc'),
    getOrderTabCounts(),
  ]);

  return (
    <OrdersClient
      initialOrders={result.orders}
      initialTotal={result.total}
      initialTotalPages={result.totalPages}
      initialTabCounts={tabCounts}
      initialUnackCount={result.unacknowledgedCount}
    />
  );
}
