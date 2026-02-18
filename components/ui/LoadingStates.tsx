'use client';
import React from 'react';

// Explicit loading state variants instead of boolean props
export const LoadingState = {
  Loading: ({ message = "Loading..." }: { message?: string }) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-slate-600">{message}</p>
          </div>
        </div>
      </div>
    </div>
  ),
  
  Saving: ({ message = "Saving..." }: { message?: string }) => (
    <div className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg opacity-50 cursor-not-allowed">
      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      <span>{message}</span>
    </div>
  ),
  
  Success: ({ message = "Saved!" }: { message?: string }) => (
    <div className="inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-green-700 text-white px-4 py-2.5 rounded-lg">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <span>{message}</span>
    </div>
  )
};

// Compound component for async operations
export const AsyncButton = {
  Root: ({ children, onClick, disabled }: { 
    children: React.ReactNode; 
    onClick: () => void; 
    disabled?: boolean 
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none"
    >
      {children}
    </button>
  ),
  
  Icon: ({ children }: { children: React.ReactNode }) => children,
  
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
};