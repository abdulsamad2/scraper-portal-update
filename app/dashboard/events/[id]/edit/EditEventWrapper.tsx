'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { EditEventForm } from '@/app/dashboard/list-event/NewScraper'
import TelechargeEventForm from '@/app/dashboard/list-telecharge-event/TelechargeEventForm'
import { isTelechargeEvent } from '@/lib/telecharge'

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

  // A Telecharge performance has its own form (show URL + performance timing).
  if (isTelechargeEvent(initialData as { Source?: string; URL?: string } | null)) {
    return (
      <TelechargeEventForm
        mode="edit"
        onCancel={handleCancel}
        onSuccess={handleSuccess}
        initialData={initialData as never}
      />
    )
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
