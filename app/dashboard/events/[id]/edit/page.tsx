import React from 'react'
import { redirect } from 'next/navigation'
import { getEventById } from '@/actions/eventActions'
import EditEventWrapper from './EditEventWrapper'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

type EventResult = {
  error?: string
  [key: string]: unknown
} | null

const page = async ({ params }: PageProps) => {
  const { id } = await params
  
  try {
    const event = await getEventById(id) as EventResult
    
    // If event not found or has error, redirect to events list
    if (!event || event.error) {
      console.error('Event not found or error fetching event:', event?.error)
      redirect('/dashboard/events')
    }
    

    
    return (
      <div>
        <EditEventWrapper initialData={event} />
      </div>
    )
  } catch (error) {
    console.error('Error in edit page:', error)
    redirect('/dashboard/events')
  }
}

export default page