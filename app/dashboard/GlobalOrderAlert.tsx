'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShoppingCart, X, Bell } from 'lucide-react';
import { useOrderAlert } from './orders/useOrderAlert';

/**
 * Global component that lives in the dashboard layout.
 * - Polls /api/orders/sync every 10s on ALL pages (not just orders page)
 * - Plays alarm sound on ANY page when new unacknowledged orders exist
 * - Shows a floating modal on non-orders pages to direct user to orders
 */
export default function GlobalOrderAlert() {
  const pathname = usePathname();
  const router = useRouter();
  const isOrdersPage = pathname === '/dashboard/orders';

  const [unackCount, setUnackCount] = useState(0);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const hasSyncedRef = useRef(false);
  const prevUnackRef = useRef(0);
  const { startAlert, stopAlert } = useOrderAlert();

  const doSync = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/sync?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.error) return;

      const count = data.unacknowledgedCount ?? 0;
      setUnackCount(count);

      if (data.newOrderIds && data.newOrderIds.length > 0) {
        setNewOrderCount(data.newOrderIds.length);
      }

      hasSyncedRef.current = true;
    } catch {
      // Network error, ignore
    }
  }, []);

  // Alert logic: play alarm on ANY page when unack count increases
  useEffect(() => {
    if (!hasSyncedRef.current) return;

    if (unackCount === 0) {
      stopAlert();
      setShowModal(false);
    } else if (unackCount > prevUnackRef.current || prevUnackRef.current === 0) {
      // New unacknowledged orders — alarm on ANY page
      startAlert();
      // Show modal only on non-orders pages
      if (!isOrdersPage) {
        setShowModal(true);
      }
    } else if (unackCount < prevUnackRef.current) {
      // Count decreased (orders confirmed/handled) — stop alarm
      stopAlert();
    }
    prevUnackRef.current = unackCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unackCount]);

  // Stop alert only on unmount
  useEffect(() => {
    return () => stopAlert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When user navigates to orders page, stop alarm & modal (OrdersClient handles its own)
  useEffect(() => {
    if (isOrdersPage) {
      stopAlert();
      setShowModal(false);
    }
  }, [isOrdersPage, stopAlert]);

  // Polling — only run when NOT on orders page (orders page has its own sync)
  useEffect(() => {
    if (isOrdersPage) return;
    // Initial sync
    const t = setTimeout(doSync, 1000);
    const iv = setInterval(doSync, 10000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [doSync, isOrdersPage]);

  // On orders page, OrdersClient handles its own sync + alerts — skip everything
  if (!showModal || isOrdersPage) return null;

  return (
    <>
      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes modal-shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); }
          20%, 40%, 60%, 80% { transform: translateX(3px); }
        }
        @keyframes bell-ring {
          0% { transform: rotate(0deg); }
          10% { transform: rotate(14deg); }
          20% { transform: rotate(-14deg); }
          30% { transform: rotate(10deg); }
          40% { transform: rotate(-10deg); }
          50% { transform: rotate(6deg); }
          60% { transform: rotate(-6deg); }
          70% { transform: rotate(2deg); }
          80% { transform: rotate(-2deg); }
          90%, 100% { transform: rotate(0deg); }
        }
        @keyframes ping-ring {
          0% { transform: scale(1); opacity: 0.8; }
          70% { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes badge-bounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.3); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(239,68,68,0.3), 0 0 60px rgba(239,68,68,0.1); }
          50% { box-shadow: 0 0 30px rgba(239,68,68,0.5), 0 0 80px rgba(239,68,68,0.2); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes border-flash {
          0%, 100% { border-color: rgba(239,68,68,0.2); }
          50% { border-color: rgba(239,68,68,0.6); }
        }
      `}</style>

      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div
          className="bg-white rounded-2xl shadow-2xl border-2 border-red-200 p-8 max-w-md w-full mx-4"
          style={{
            animation: 'slide-up 0.4s ease-out, glow-pulse 2s ease-in-out infinite, border-flash 1.5s ease-in-out infinite',
          }}
        >
          {/* Animated bell with ripple rings */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              {/* Outer ping rings */}
              <div className="absolute inset-0 w-20 h-20 -m-2 rounded-full bg-red-400/30"
                style={{ animation: 'ping-ring 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />
              <div className="absolute inset-0 w-20 h-20 -m-2 rounded-full bg-red-400/20"
                style={{ animation: 'ping-ring 1.5s cubic-bezier(0,0,0.2,1) infinite 0.5s' }} />

              {/* Bell circle */}
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg shadow-red-200 relative z-10">
                <Bell className="w-8 h-8 text-white" style={{ animation: 'bell-ring 1s ease-in-out infinite', transformOrigin: 'top center' }} />
              </div>

              {/* Count badge */}
              <span
                className="absolute -top-2 -right-2 min-w-[28px] h-7 bg-red-600 text-white text-sm font-black rounded-full flex items-center justify-center px-1.5 z-20 border-2 border-white shadow-md"
                style={{ animation: 'badge-bounce 1s ease-in-out infinite' }}
              >
                {unackCount}
              </span>
            </div>
          </div>

          {/* Urgent header */}
          <div className="text-center mb-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-[11px] font-bold uppercase tracking-wider"
              style={{ animation: 'badge-bounce 2s ease-in-out infinite' }}>
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Urgent
            </span>
          </div>

          <h2 className="text-2xl font-black text-gray-900 text-center mb-2 mt-3">
            New Order{unackCount > 1 ? 's' : ''} Received!
          </h2>
          <p className="text-gray-500 text-center text-sm mb-6">
            You have{' '}
            <span className="font-black text-red-600 text-lg" style={{ animation: 'badge-bounce 1.5s ease-in-out infinite' }}>
              {unackCount}
            </span>{' '}
            unacknowledged order{unackCount > 1 ? 's' : ''} waiting for action.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setShowModal(false);
                stopAlert();
                router.push('/dashboard/orders');
              }}
              className="w-full px-6 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold text-base hover:from-red-700 hover:to-red-600 transition-all shadow-lg shadow-red-200 flex items-center justify-center gap-2"
              style={{ animation: 'modal-shake 3s ease-in-out infinite 2s' }}
            >
              <ShoppingCart className="w-5 h-5" />
              Go to Orders Now
            </button>
            <button
              onClick={() => setShowModal(false)}
              className="w-full px-6 py-2.5 rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 font-medium text-xs transition-all flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
