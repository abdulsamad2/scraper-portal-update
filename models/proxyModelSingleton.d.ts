import { Document, Model } from 'mongoose';

export interface IProxy extends Document {
  proxy_id: string;
  server: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  provider?: string;
  region?: string;
  country_code?: string;
  status: 'active' | 'inactive' | 'blacklisted' | 'maintenance';
  is_working: boolean;
  last_tested: Date;
  response_time: number;
  success_rate: number;
  total_requests: number;
  failed_requests: number;
  current_usage_count: number;
  max_concurrent_usage: number;
  last_used?: Date;
  requests_per_minute_limit: number;
  requests_this_minute: number;
  minute_window_start: Date;
  assigned_events: Array<{
    event_id: string;
    assigned_at: Date;
  }>;
  consecutive_failures: number;
  last_error?: {
    message: string;
    timestamp: Date;
    error_code: string;
  };
  blacklisted_events: string[];
  whitelisted_events: string[];
  rotation_weight: number;
  tags: string[];
  raw_proxy_string: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtuals
  proxy_url?: string;
  proxy_object?: any;
  
  // Methods
  incrementUsage(): Promise<IProxy>;
  recordFailure(error?: any): Promise<IProxy>;
  recordSuccess(responseTime?: number): Promise<IProxy>;
  assignToEvent(eventId: string): Promise<IProxy>;
  releaseFromEvent(eventId: string): Promise<IProxy>;
}

export interface IProxyModel extends Model<IProxy> {
  parseRawProxy(rawProxyString: string): any;
  createFromRaw(rawProxyString: string, additionalData?: any): Promise<IProxy>;
  getAvailableProxies(filters?: any): Promise<IProxy[]>;
}

declare const Proxy: IProxyModel;
export { Proxy, IProxy, IProxyModel };
