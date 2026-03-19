import React, { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getEventById } from '@/actions/eventActions'
import EditEventWrapper from './EditEventWrapper'

interface PageProps {
  params: Promise<{ id: string }>
}

type EventResult = {
  error?: string
  [key: string]: unknown
} | null

function EditFormSkeleton() {
  return (
    <div className="animate-pulse space-y-4 max-w-2xl">
      <div className="h-8 bg-gray-200 rounded w-48" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-10 bg-gray-100 rounded w-full" />
        </div>
      ))}
      <div className="h-10 bg-gray-200 rounded w-32 mt-6" />
    </div>
  )
}

async function EditContent({ id }: { id: string }) {
  const event = await getEventById(id) as EventResult
  if (!event || event.error) {
    redirect('/dashboard/events')
  }
  return <EditEventWrapper initialData={event} />
}

export default async function EditPage({ params }: PageProps) {
  const { id } = await params
  return (
    <Suspense fallback={<EditFormSkeleton />}>
      <EditContent id={id} />
    </Suspense>
  )
}
