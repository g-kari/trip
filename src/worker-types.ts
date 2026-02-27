/// <reference types="@cloudflare/workers-types" />
import type { User } from './auth/types';

export type Bindings = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  COVERS: R2Bucket;
  AI: Ai;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
};

export type Vars = {
  user: User | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Vars;
};

// AI-related types used in route optimization
export type OptimizedItem = {
  id: string;
  title: string;
  area: string | null;
  timeStart: string | null;
  reason: string;
};

// AI trip generation types
export type TripStyle = 'relaxed' | 'active' | 'gourmet' | 'sightseeing';

export interface GeneratedItem {
  title: string;
  timeStart: string;
  timeEnd?: string;
  area?: string;
  note?: string;
  cost?: number;
}

export interface GeneratedDay {
  date: string;
  items: GeneratedItem[];
}

export interface GeneratedTrip {
  title: string;
  days: GeneratedDay[];
}

// Weather types
export type WeatherInfo = {
  description: string;
  icon: string;
};
