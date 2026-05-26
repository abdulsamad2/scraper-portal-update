# 🚀 Scraper Portal

<p align="center">
  <a href="#-features">Features</a> • 
  <a href="#-quick-start">Quick Start</a> • 
  <a href="#-documentation">Documentation</a> • 
  <a href="#-api">API</a>
</p>

<p align="center">
  <b>A powerful all-in-one scraper management platform with real-time monitoring, automated data collection, and seamless deployment pipelines.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15.3.8-000000.svg?style=for--the--grid&logo=nextjs" alt="Next.js Version" />
  <img src="https://img.shields.io/badge/React-19-20232A.svg?style=for--the--grid&logo=react" alt="React Version" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6.svg?style=for--the--grid&logo=typescript" alt="TypeScript Version" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4.svg?style=for--the--grid&logo=tailwindcss" alt="Tailwind Version" />
  <img src="https://img.shields.io/badge/MongoDB-8.0-47A248.svg?style=for--the--grid&logo=mongodb" alt="MongoDB Version" />
</p>

---

## ✨ Features

### 🔐 Advanced Authentication
**Secure user management with enterprise-grade security**
- Password-based registration with email verification
- JWT token-based session management
- Secure password reset with email validation
- Protected routes with role-based access control
- Automatic session expiration and refresh

### 📊 Event Management
**Comprehensive event organization and tracking**
- Create and manage events with flexible categories
- Multi-category support with advanced filtering
- Create unlimited events with detailed metadata
- Track event status, dates, and participants
- Bulk import/export capabilities

### 📦 Inventory System
**Real-time inventory monitoring and alerts**
- Automated price tracking with history charts
- Stock availability monitoring in real-time
- Smart price change detection and notifications
- Low stock alerts with configurable thresholds
- CSV export with custom field selection
- Visual inventory analytics dashboard

### 🤖 Scraping Automation
**Powerful data extraction pipelines**
- Automated periodic data collection (configurable intervals)
- Custom scraper creation with templates
- Multi-source data aggregation
- Error handling and retry logic
- Proxy rotation support
- Headless browser automation (Puppeteer)

### 📈 System Monitoring
**Complete platform visibility**
- Server health status tracking
- Database connection monitoring
- Memory and CPU usage analytics
- Active user tracking
- Real-time performance metrics
- System logs with search and filtering

### 🎯 Additional Capabilities
- 🖥️ Modern responsive admin dashboard
- 📧 Email notifications via Resend API
- 💾 MongoDB data persistence
- 🔄 Webhook integrations
- 🔍 Advanced search and filtering
- ⚡ Optimized with Next.js 15 App Router

---

## 🏗️ Tech Stack

| Category | Technology | Version |
|---------|-----------|--------|
| **Framework** | Next.js | 15.3.8 |
| **UI Library** | React | 19.0.0 |
| **Styling** | Tailwind CSS | 4.0.9 |
| **Language** | TypeScript | 5.8.0 |
| **Database** | MongoDB | 8.15.0 |
| **State Management** | Zustand | 5.0.5 |
| **HTTP Client** | Axios | 1.9.0 |
| **Icons** | Lucide React | 0.501.0 |

---

## 🚀 Quick Start

### Prerequisites

```bash
# Node.js 20.13.1 or higher
node --version

# npm 10.5.2 or higher (included with Node.js)
npm --version

# MongoDB (local or Atlas)
# Download: https://www.mongodb.com/try/download/community
```

### Installation

**1. Clone the repository**

```bash
# Using HTTPS
git clone https://github.com/your-repo/scraper-portal.git

# OR using SSH
git clone git@github.com:your-repo/scraper-portal.git

cd scraper-portal
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment variables**

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Then update the variables (see [Environment Variables](#-environment-variables) section below).

**4. Start MongoDB**

*Option A: Local MongoDB*
```bash
# Start MongoDB service (macOS/Linux)
sudo systemctl start mongod

# OR if using MongoDB Compass
docker-compose up -d
```

*Option B: MongoDB Atlas (recommended for production)*
```bash
# Use your Atlas connection string in MONGODB_URI
# No local setup required!
```

**5. Run the development server**

```bash
npm run dev
```

🎉 **Your app is now running at** [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm start
```

---

## 📚 Documentation

### 🔑 Authentication Flow

The application implements a secure authentication system:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Register   │───┼──│   Login    │───┼──│ Password   │
│  (Signup)   │   │  │   (Sign In │   │  Reset       │
└─────────────┘   │  └───────────┘   │  └─────────────┘
                  │                  │
                  ▼                  ▼
          ┌──────────────┐    ┌──────────────┐
          │ JWT Token    │    │ Email Reset  │
          │ Generation   │    │ Token        │
          └──────────────┘    │ Generation   │
                  │           └──────────────┘
                  │                  │
                  └────────┬─────────┘
                           ▼
                    ┌──────────────┐
                    │ Protected    │
                    │ Routes &     │
                    │ Dashboard    │
                    └──────────────┘
```

**Key Features:**
- Password hashing with bcrypt (12 rounds)
- JWT tokens with 24-hour expiration
- Email verification via Resend API
- Secure password reset workflow
- Automatic token refresh

### 📝 API Documentation

#### Authentication Endpoints

**Register New User**
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Login**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Password Reset Request**
```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "john@example.com"
}
```

**Reset Password**
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "reset-token-from-email",
  "newPassword": "NewSecurePass123!"
}
```

#### Events Endpoints

**Create Event**
```http
POST /api/events
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Product Launch",
  "description": "New product release event",
  "date": "2024-12-25",
  "location": "San Francisco, CA",
  "category": "Business",
  "status": "upcoming"
}
```

**Get All Events**
```http
GET /api/events
Authorization: Bearer <token>

Query Parameters:
- category: Filter by category
- status: Filter by status
- limit: Number of results (default: 10)
- page: Page number for pagination
```

**Update Event**
```http
PUT /api/events/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Event Name",
  "description": "Updated description"
}
```

**Delete Event**
```http
DELETE /api/events/:id
Authorization: Bearer <token>
```

#### Inventory Endpoints

**Get Inventory**
```http
GET /api/inventory
Authorization: Bearer <token>

Query Parameters:
- category: Filter by category
- minPrice: Minimum price filter
- maxPrice: Maximum price filter
- outOfStock: Filter out-of-stock items (true/false)
- priceChange: Filter by price change (increased/decreased/no-change)
```

**Export Inventory**
```http
GET /api/inventory/export
Authorization: Bearer <token>

Returns: CSV file with current inventory data
```

**Update Inventory Item**
```http
PUT /api/inventory/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "price": 99.99,
  "stock": 150,
  "priceHistory": [...]
}
```

#### System Status Endpoint

**Get System Health**
```http
GET /api/system/status
Authorization: Bearer <token>

Response:
{
  "server": {
    "status": "healthy",
    "uptime": 86400,
    "memory": {
      "used": "256MB",
      "available": "7GC:
    "cpu": {
      "usage": "23%"
    }
  },
  "mongodb": {
    "connected": true,
    "ping": "15ms"
  },
  "activeUsers": 42,
  "lastCheck": "2024-12-10T12:00:00Z"
}
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env.local` file with the following variables:

```bash
# ===== Database Configuration =====
MONGODB_URI=mongodb://localhost:27017/scraper-portal
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/scraper-portal

# ===== Application Settings =====
NEXT_PUBLIC_APP_URL=http://localhost:3000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

# ===== Email Configuration (Resend) =====
RESEND_API_KEY=re_your_resend_api_key_here
RESEND_FROM_EMAIL=noreply@yourdomain.com

# ===== Optional: ScrapeShield Configuration =====
SCRAPESHIELD_API_KEY=your_scrapeshield_api_key
SCRAPESHIELD_URL=https://api.scraper.com/v2

# ===== Optional: Proxy Configuration =====
HTTP_PROXY=http://proxy-server:port
HTTPS_PROXY=http://proxy-server:port

# ===== Optional: Custom Domain (Production) =====
# NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### Script Commands

| Command | Description |
 `npm run dev` | Start development server with hot reload |
| `npm run build` | Build optimized production bundle |
| `npm start` | Start production server (requires build first) |
| `npm run lint` | Run ESLint for code quality checking |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run update-pricing` | Update pricing data for subscriptions |

### Development Tips

**Hot Module Replacement (HMR)**
- Changes to React components are automatically reflected
- No manual refresh needed for UI changes
- Server-side code requires manual restart (`Ctrl+C`, then `npm run dev`)

**TypeScript Strict Mode**
- Full type checking enabled
- Use `// @ts-ignore` only when absolutely necessary
- Run `npm run typecheck` before committing

**Database Migrations**
- Schema changes are handled automatically by Mongoose
- No migration scripts required for simple changes

---

## 🐛 Troubleshooting

### Common Issues & Solutions

#### MongoDB Connection Errors

**Error:** `MongoServerError: connect ECONNREFUSED`

**Solutions:**
```bash
# 1. Check if MongoDB is running
# macOS
brew services list | grep mongodb

# Linux
systemctl status mongod

# 2. Start MongoDB
# macOS (if installed via Brew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# 3. Verify MongoDB is accessible
mongosh
```

#### Port Already in Use

**Error:** `Something is already running on port 3000`

**Solutions:**
```bash
# Find and kill the process using port 3000
lsof -i :3000
kill -9 <PID>

# OR run on a different port
PORT=3001 npm run dev
```

#### JWT Token Errors

**Error:** `jwt malformed` or `Token expired`

**Solutions:**
- Clear browser cookies and local storage
- Login again to get a new token
- Check that JWT_SECRET matches between server and client
- Verify JWT expiration time in environment variables

#### Email Not Sending

**Issue:** Password reset emails not arriving

**Solutions:**
1. Check Resend API key is correctly set
2. Verify email address is valid
3. Check Resend dashboard for delivery logs
4. Ensure `RESEND_FROM_EMAIL` is verified in Resend
5. Check spam folder for test emails

#### Build Errors

**Error:** `Failed to compile` during build

**Solutions:**
```bash
# Clear Next.js cache
rm -rf .next
npm run build

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Getting Help

**Still stuck?** Try these resources:

1. **Check Logs:** `npm run dev` shows detailed error messages
2. **Console Logs:** Open browser DevTools (F12) and check Console/Network tabs
3. **Next.js Docs:** [https://nextjs.org/docs](https://nextjs.org/docs)
4. **MongoDB Docs:** [https://developer.mongodb.com](https://developer.mongodb.com)
5. **GitHub Issues:** Report bugs or ask questions in the repository

---

## 📁 Project Structure

```
scraper-portal/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Authentication routes
│   │   ├── (dashboard)/       # Protected dashboard pages
│   │   ├── api/              # API routes
│   │   │   ├── auth/         # Authentication endpoints
│   │   │   ├── events/       # Event management endpoints
│   │   │   ├── inventory/    # Inventory endpoints
│   │   │   └── system/       # System status endpoints
│   │   └── layout.tsx        # Root layout
│   ├── components/            # React components
│   │   ├── auth/             # Authentication components
│   │   ├── dashboard/        # Dashboard UI components
│   │   ├── events/           # Event-related components
│   │   └── inventory/        # Inventory components
│   ├── lib/                  # Utility functions
│   │   ├── auth/             # Authentication logic
│   │   ├── mongodb.ts        # MongoDB connection
│   │   └── email.ts          # Email sending functions
│   ├── models/               # MongoDB schemas
│   │   ├── User.ts
│   │   ├── Event.ts
│   │   └── Inventory.ts
│   └── stores/               # Zustand state stores
├── public/                   # Static assets
├── .env.example             # Environment variable template
├── next.config.js          # Next.js configuration
├── tailwind.config.js      # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
└── package.json            # Dependencies and scripts
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Quick Guide

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Run tests** (`npm test`)
5. **Run linter** (`npm run lint`)
6. **Run type check** (`npm run typecheck`)
7. **Commit your changes** (`git commit -m 'Add amazing feature'`)
8. **Push to the branch** (`git push origin feature/amazing-feature`)
9. **Open a Pull Request**

---

## 📄 License

This project is proprietary and confidential. All rights reserved.

---

## 🙏 Acknowledgments

Built with:
- [Next.js](https://nextjs.org/) - The React Framework
- [React](https://react.dev/) - A library for web and native user interfaces
- [TypeScript](https://www.typescriptlang.org/) - JavaScript with syntax for types
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [MongoDB](https://www.mongodb.com/) - MongoDB Database
- [Zustand](https://github.com/pmndrs/zustand) - thighly performant state management
- [Lucide Icons](https://lucide.dev/) - Simple, clean icons built by the frontend community

**Made with ❤️ by the Scraper Portal Team**
