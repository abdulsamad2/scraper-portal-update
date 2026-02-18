'use client';
import React from 'react';
import { ArrowLeft, Save, Loader, AlertCircle, CheckCircle } from 'lucide-react';

// Explicit mode variants instead of boolean `isEdit` prop
export const EventFormMode = {
  Create: {
    Header: ({ onCancel }: { onCancel: () => void }) => (
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Back to events"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">Add New Event</h1>
            <p className="text-sm text-gray-500">Create a new event to track ticket availability</p>
          </div>
        </div>
      </div>
    ),
    
    SubmitButton: ({ 
      state, 
      onCancel 
    }: { 
      state: 'idle' | 'submitting' | 'success' | 'error';
      onCancel: () => void;
    }) => (
      <div className="flex items-center justify-end space-x-4 pt-4 border-t mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          disabled={state === 'submitting'}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state === 'submitting'}
          className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
            state === 'submitting' ? "opacity-70 cursor-not-allowed" : ""
          }`}
        >
          {state === 'submitting' ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Start Tracking
            </>
          )}
        </button>
      </div>
    )
  },

  Edit: {
    Header: ({ onCancel }: { onCancel: () => void }) => (
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Back to events"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">Edit Event</h1>
            <p className="text-sm text-gray-500">Update event details</p>
          </div>
        </div>
      </div>
    ),
    
    SubmitButton: ({ 
      state, 
      onCancel 
    }: { 
      state: 'idle' | 'submitting' | 'success' | 'error';
      onCancel: () => void;
    }) => (
      <div className="flex items-center justify-end space-x-4 pt-4 border-t mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          disabled={state === 'submitting'}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state === 'submitting'}
          className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
            state === 'submitting' ? "opacity-70 cursor-not-allowed" : ""
          }`}
        >
          {state === 'submitting' ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Updating...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Update Event
            </>
          )}
        </button>
      </div>
    )
  }
};

// Status message variants instead of conditional rendering
export const FormStatusMessages = {
  Error: ({ message }: { message: string }) => (
    <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-red-700">{message}</p>
    </div>
  ),
  
  Success: ({ message }: { message: string }) => (
    <div className="mb-6 bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg flex items-start gap-3">
      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-green-700">{message}</p>
    </div>
  )
};