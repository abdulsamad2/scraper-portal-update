"use client";
import { useRouter } from 'next/navigation';
import TelechargeEventForm from './TelechargeEventForm';

export default function ListTelechargeEventPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <TelechargeEventForm
        mode="create"
        onCancel={() => router.push('/dashboard/events')}
        onSuccess={() => router.push('/dashboard/events')}
      />
    </div>
  );
}
