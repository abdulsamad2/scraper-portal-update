'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import NewScraper from '@/app/dashboard/list-event/NewScraper'

interface EditEventWrapperProps {
  initialData: any
}

const EditEventWrapper: React.FC<EditEventWrapperProps> = ({ initialData }) => {
  const router = useRouter()

  const handleCancel = () => {
    router.push('/dashboard/events')
  }

  const handleSuccess = () => {
    router.push('/dashboard/events')
  }

  return (
    <NewScraper 
      onCancel={handleCancel} 
      onSuccess={handleSuccess} 
      isEdit={true} 
      initialData={initialData} 
    />
  )
}

export default EditEventWrapper
