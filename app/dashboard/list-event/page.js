"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NewScraper from './NewScraper';

export default function ListEventPage() {
  const router = useRouter();

  const handleCancel = () => {
    router.push('/dashboard/events');
  };

  const handleSuccess = (data) => {
    // Redirect to events page after successful creation
    router.push('/dashboard/events');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NewScraper onCancel={handleCancel} onSuccess={handleSuccess} />
    </div>
  );
}