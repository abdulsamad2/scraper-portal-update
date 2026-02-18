'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Play, Square, Edit, Filter, Trash2 } from 'lucide-react';
import { updateEvent, deleteEvent } from '@/actions/eventActions';

interface Props {
  eventId: string;
  eventName: string;
  isScrapingActive: boolean;
}

export default function EventDetailActions({ eventId, eventName, isScrapingActive }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticActive, setOptimisticActive] = useState(isScrapingActive);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');

  const handleToggle = () => {
    const next = !optimisticActive;
    setOptimisticActive(next);
    setLiveMsg(next ? 'Starting scraping…' : 'Stopping scraping…');
    startTransition(async () => {
      try {
        await updateEvent(eventId, { Skip_Scraping: !next }, false);
        router.refresh();
        setLiveMsg(next ? 'Scraping started.' : 'Scraping stopped.');
      } catch {
        setOptimisticActive(!next); // revert
        setLiveMsg('Failed to update scraping status. Please try again.');
      }
    });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setLiveMsg('Deleting event…');
    try {
      await deleteEvent(eventId);
      router.push('/dashboard/events');
    } catch {
      setIsDeleting(false);
      setLiveMsg('Failed to delete event. Please try again.');
    }
  };

  return (
    <>
      {/* Screen-reader live region */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{liveMsg}</div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Start / Stop */}
        <button
          onClick={handleToggle}
          disabled={isPending}
          aria-label={isPending
            ? (optimisticActive ? 'Stopping scraping…' : 'Starting scraping…')
            : (optimisticActive ? `Stop scraping ${eventName}` : `Start scraping ${eventName}`)}
          aria-busy={isPending}
          style={{ touchAction: 'manipulation' }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-[background-color,opacity,box-shadow] duration-150 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 shadow-sm ${
            optimisticActive
              ? 'bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500'
              : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white focus-visible:ring-blue-500'
          }`}
        >
          {isPending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          ) : optimisticActive ? (
            <Square size={15} aria-hidden="true" />
          ) : (
            <Play size={15} aria-hidden="true" />
          )}
          <span>{isPending ? (optimisticActive ? 'Stopping…' : 'Starting…') : (optimisticActive ? 'Stop Scraping' : 'Start Scraping')}</span>
        </button>

        {/* Edit */}
        <Link
          href={`/dashboard/events/${eventId}/edit`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          <Edit size={15} aria-hidden="true" />
          Edit Event
        </Link>

        {/* Exclusions */}
        <Link
          href={`/dashboard/events/${eventId}/exclusions`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2"
        >
          <Filter size={15} aria-hidden="true" />
          Exclusions
        </Link>

        {/* Delete */}
        <button
          onClick={() => setShowDeleteConfirm(true)}
          aria-label={`Delete event ${eventName}`}
          style={{ touchAction: 'manipulation' }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-white text-red-600 hover:bg-red-50 border border-red-200 transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
        >
          <Trash2 size={15} aria-hidden="true" />
          Delete
        </button>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h2 id="delete-dialog-title" className="text-lg font-bold text-slate-900 mb-2 text-balance">
              Delete "{eventName}"?
            </h2>
            <p className="text-slate-600 text-sm mb-6 text-pretty">
              This permanently removes the event and all associated seat inventory. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-[background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 transition-[background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                style={{ touchAction: 'manipulation' }}
              >
                {isDeleting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />}
                {isDeleting ? 'Deleting…' : 'Delete Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
