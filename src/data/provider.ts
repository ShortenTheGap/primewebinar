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
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`API ${res.status}: ${detail || 'Unknown error'}`);
  }
  return res.json();
}
