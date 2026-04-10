import type { DashboardPayload } from '../types';
import { seedData } from './seed';

const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || 'static';

export async function getDashboardData(cohort?: string): Promise<DashboardPayload> {
  if (DATA_SOURCE === 'static') {
    return seedData;
  }

  const params = new URLSearchParams();
  params.set('cohort', cohort || 'all');
  const res = await fetch(`/api/dashboard?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Dashboard API error: ${res.status}`);
  }
  return res.json();
}
