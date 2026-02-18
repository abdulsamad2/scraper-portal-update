'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { EditEventForm } from '@/app/dashboard/list-event/NewScraper'

interface EditEventWrapperProps {
  initialData: Record<string, unknown> | null
}

const EditEventWrapper: React.FC<EditEventWrapperProps> = ({ initialData }) => {
  const router = useRouter()

  const handleCancel = () => {
    router.push('/dashboard/events')
  }

  const handleSuccess = () => {
    router.push('/dashboard/events')
  }

  // Use explicit EditEventForm component instead of boolean prop
  return (
    <EditEventForm 
      onCancel={handleCancel} 
      onSuccess={handleSuccess} 
      initialData={initialData as never} 
    />
  )
}

export default EditEventWrapper
