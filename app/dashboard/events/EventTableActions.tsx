'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Edit, Trash2, Play, Square, Eye, MoreHorizontal } from 'lucide-react';
import { updateEvent, deleteEvent } from '@/actions/eventActions';

interface EventTableActionsProps {
  eventId: string;
  eventName: string;
  isScrapingActive: boolean;
  compact?: boolean;
}

export default function EventTableActions({
  eventId,
  eventName,
  isScrapingActive,
  compact = false
}: EventTableActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isToggling, setIsToggling] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Toggle scraping status
  const handleToggleScraping = async () => {
    setIsToggling(true);
    startTransition(async () => {
      try {
        await updateEvent(eventId, { Skip_Scraping: isScrapingActive }, true);
        router.refresh(); // Refresh the server data
      } catch (error) {
        console.error('Error toggling scraping:', error);
      } finally {
        setIsToggling(false);
      }
    });
  };

  // Delete event
  const handleDelete = async () => {
    startTransition(async () => {
      try {
        await deleteEvent(eventId);
        setShowDeleteConfirm(false);
        router.refresh(); // Refresh the server data
      } catch (error) {
        console.error('Error deleting event:', error);
      }
    });
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        >
          <MoreHorizontal size={16} />
        </button>
        
        {showDropdown && (
          <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-40">
            <Link
              href={`/dashboard/events/${eventId}`}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg"
            >
              <Eye size={14} />
              View
            </Link>
            
            <Link
              href={`/dashboard/events/${eventId}/edit`}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Edit size={14} />
              Edit
            </Link>
            
            <button
              onClick={handleToggleScraping}
              disabled={isToggling}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isToggling ? (
                <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : isScrapingActive ? (
                <Square size={14} />
              ) : (
                <Play size={14} />
              )}
              {isToggling ? 'Processing...' : isScrapingActive ? 'Stop' : 'Start'}
            </button>
            
            <button
              onClick={() => {
                setShowDeleteConfirm(true);
                setShowDropdown(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 last:rounded-b-lg"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
        
        {/* Click outside to close */}
        {showDropdown && (
          <div 
            className="fixed inset-0 z-0" 
            onClick={() => setShowDropdown(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-1 items-center justify-end">
      <Link
        href={`/dashboard/events/${eventId}`}
        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
        aria-label={`View ${eventName}`}
      >
        <Eye size={14} aria-hidden="true" />
      </Link>
      
      <Link
        href={`/dashboard/events/${eventId}/edit`}
        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        aria-label={`Edit ${eventName}`}
      >
        <Edit size={14} aria-hidden="true" />
      </Link>
      
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
        aria-label={`Delete ${eventName}`}
        style={{ touchAction: 'manipulation' }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
      
      <button
        onClick={handleToggleScraping}
        disabled={isToggling}
        aria-label={isToggling ? `Updating ${eventName}…` : isScrapingActive ? `Stop scraping ${eventName}` : `Start scraping ${eventName}`}
        aria-busy={isToggling}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition-[background-color,opacity] duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
          isToggling
            ? 'bg-gray-400 text-white focus-visible:ring-gray-400'
            : isScrapingActive 
            ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500' 
            : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 focus-visible:ring-blue-500'
        }`}
        style={{ touchAction: 'manipulation' }}
      >
        {isToggling ? (
          <>
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
            <span aria-hidden="true">…</span>
          </>
        ) : isScrapingActive ? (
          <>
            <Square size={11} aria-hidden="true" />
            <span>Stop</span>
          </>
        ) : (
          <>
            <Play size={11} aria-hidden="true" />
            <span>Start</span>
          </>
        )}
      </button>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Delete Event
            </h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete "{eventName}"? This action cannot be undone and will also delete all associated seat inventory data.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Event'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}