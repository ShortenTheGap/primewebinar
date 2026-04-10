import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';

interface MetaInsight {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  ad_id?: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  date_start: string;
}

export function startMetaAdsCron(): void {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!accessToken || !adAccountId) {
    console.warn('META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set — skipping Meta Ads cron job');
    return;
  }

  console.log('Meta Ads cron job scheduled (daily at 6:00 AM UTC)');

  cron.schedule('0 6 * * *', async () => {
    console.log('Running Meta Ads sync...');

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      const fields = 'campaign_id,campaign_name,adset_id,impressions,clicks,spend,reach,date_start';
      const url = new URL(`https://graph.facebook.com/v19.0/act_${adAccountId}/insights`);
      url.searchParams.set('fields', fields);
      url.searchParams.set('breakdowns', 'ad_id');
      url.searchParams.set('time_range', JSON.stringify({ since: dateStr, until: dateStr }));
      url.searchParams.set('level', 'ad');
      url.searchParams.set('limit', '500');
      url.searchParams.set('access_token', accessToken);

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Meta API error (${response.status}):`, errorBody);
        return;
      }

      const json = await response.json();
      const insights: MetaInsight[] = json.data || [];

      if (insights.length === 0) {
        console.log('No Meta Ads insights returned for', dateStr);
        return;
      }

      const rows = insights.map((row) => ({
        date: row.date_start,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        adset_id: row.adset_id,
        ad_id: row.ad_id || null,
        impressions: parseInt(row.impressions, 10) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        spend: parseFloat(row.spend) || 0,
        reach: parseInt(row.reach, 10) || 0,
      }));

      const { error } = await supabase
        .from('ad_spend')
        .upsert(rows, { onConflict: 'date,campaign_id' });

      if (error) {
        console.error('Error upserting ad_spend:', error);
      } else {
        console.log(`Meta Ads sync complete: ${rows.length} rows upserted for ${dateStr}`);
      }
    } catch (err) {
      console.error('Meta Ads cron job failed:', err);
    }
  });
}
