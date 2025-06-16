# Scraper Portal

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Overview

Scraper Portal is a comprehensive event scraping and inventory management system designed for ticket resellers. The portal provides a complete solution for managing events, tracking seat inventory, and exporting data for external systems.

## Features

### 🔐 Authentication System
- **Secure Login**: Protected dashboard with cookie-based authentication
- **Session Management**: Automatic session handling with middleware protection
- **Logout Functionality**: Clean session termination and redirect

### 📊 Dashboard
- **Overview Statistics**: Real-time metrics for events, seats, and errors
- **Recent Events Display**: Quick access to latest event information
- **Error Monitoring**: Track and display system errors and logs
- **Responsive Design**: Modern UI with Tailwind CSS styling

### 🎫 Event Management
- **Event Creation**: Add new events with comprehensive details
  - Event name, date, and venue information
  - Ticketmaster URL integration
  - Automatic Event ID extraction from URLs
  - Zone and pricing configuration
  - Skip scraping toggle for manual control
- **Event Listing**: Paginated view of all events with search functionality
- **Event Editing**: Update event details and scraping settings
- **Bulk Operations**: Toggle scraping for multiple events
- **Event Deletion**: Remove events from the system

### 🪑 Inventory Management
- **Seat Group Tracking**: Manage consecutive seat groups
- **Real-time Inventory**: Live updates of available seats
- **Advanced Filtering**: Filter by event, mapping, section, and row
- **Pagination**: Efficient handling of large inventory datasets
- **Seat Details**: Comprehensive seat information including:
  - Section, row, and seat numbers
  - Pricing information
  - Availability status
  - Mapping IDs for external systems

### 📤 CSV Export System
- **Automated CSV Generation**: Create inventory exports in standardized format
- **Scheduled Exports**: Configurable automatic export scheduling
- **External Integration**: Upload to sync services automatically
- **Custom Formatting**: Industry-standard CSV format with all required fields
- **Export History**: Track export status and timestamps
- **Manual Export**: On-demand CSV generation and download

### 🔄 Data Synchronization
- **External API Integration**: Sync with third-party ticket management systems
- **Real-time Updates**: Live data synchronization capabilities
- **Error Handling**: Robust error logging and recovery
- **Status Monitoring**: Track sync operations and their status

### 🛠️ Technical Features
- **MongoDB Integration**: Robust database with Mongoose ODM
- **Server Actions**: Next.js 13+ app router with server-side operations
- **Middleware Protection**: Route-level authentication and authorization
- **Error Logging**: Comprehensive error tracking and monitoring
- **Responsive Design**: Mobile-friendly interface
- **Modern Icons**: Lucide React icon library integration

## Technology Stack

- **Frontend**: Next.js 13+ with App Router
- **Styling**: Tailwind CSS
- **Database**: MongoDB with Mongoose
- **Authentication**: Cookie-based sessions
- **Icons**: Lucide React
- **Language**: TypeScript/JavaScript

## Database Models

### Event Model
- Event ID and mapping ID
- Event name, date, and venue
- Ticketmaster URL
- Zone and pricing configuration
- Scraping control flags
- Availability tracking

### Seat Model (Consecutive Groups)
- Section, row, and seat information
- Event association
- Inventory quantities
- Pricing details
- Status tracking

### Error Logging
- Comprehensive error tracking
- Timestamp and categorization
- Debug information storage

### Scheduler Settings
- CSV export automation
- Sync service configuration
- Timing and frequency settings

## API Endpoints

- **Event Management**: CRUD operations for events
- **Inventory Operations**: Seat group management
- **CSV Generation**: Export functionality
- **Error Logging**: System monitoring
- **Authentication**: Login/logout handling

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
scraper-portal/
├── app/                    # Next.js app directory
│   ├── dashboard/         # Main dashboard pages
│   ├── login/            # Authentication
│   └── api/              # API routes
├── actions/              # Server actions
├── models/               # Database models
├── lib/                  # Utility libraries
├── middleware.ts         # Route protection
└── public/              # Static assets
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

---

*Made with ❤️ by AbdulSamad*
