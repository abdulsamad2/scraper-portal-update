'use client';
import React, { createContext, useContext, useState, ReactNode } from 'react';
import { AlertTriangle, Info, CheckCircle, X } from 'lucide-react';

// Define interface for better dependency injection
interface NotificationState {
  type: 'success' | 'error' | 'info';
  message: string;
  id: string;
}

interface NotificationContextInterface {
  notifications: NotificationState[];
  actions: {
    showNotification: (type: 'success' | 'error' | 'info', message: string) => void;
    removeNotification: (id: string) => void;
    clearAll: () => void;
  };
  meta: {
    hasNotifications: boolean;
    count: number;
  };
}

const NotificationContext = createContext<NotificationContextInterface | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationState[]>([]);

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    const notification = { type, message, id };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const contextValue: NotificationContextInterface = {
    notifications,
    actions: {
      showNotification,
      removeNotification,
      clearAll,
    },
    meta: {
      hasNotifications: notifications.length > 0,
      count: notifications.length,
    },
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <NotificationContainer />
    </NotificationContext.Provider>
  );
}

function NotificationContainer() {
  const context = useContext(NotificationContext);
  if (!context) return null;

  const { notifications, actions } = context;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map(notification => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onRemove={() => actions.removeNotification(notification.id)}
        />
      ))}
    </div>
  );
}

function NotificationCard({ 
  notification, 
  onRemove 
}: { 
  notification: NotificationState;
  onRemove: () => void;
}) {
  const iconMap = {
    success: CheckCircle,
    error: AlertTriangle,
    info: Info,
  };

  const styleMap = {
    success: 'bg-green-50 text-green-800 border-green-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
  };

  const Icon = iconMap[notification.type];

  return (
    <div className={`p-4 rounded-2xl shadow-sm border flex items-center justify-between min-w-80 ${styleMap[notification.type]}`}>
      <div className="flex items-center space-x-2">
        <Icon size={20} />
        <span className="font-medium">{notification.message}</span>
      </div>
      <button
        onClick={onRemove}
        className="text-current hover:opacity-70 transition-opacity"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}