import cron from 'node-cron';
import { query } from '../lib/db.js';

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

      let upserted = 0;
      for (const row of insights) {
        await query(
          `INSERT INTO ad_spend (date, campaign_id, campaign_name, adset_id, creative_id, impressions, clicks, spend, reach, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (date, campaign_id) DO UPDATE SET
             campaign_name = EXCLUDED.campaign_name,
             adset_id = EXCLUDED.adset_id,
             creative_id = EXCLUDED.creative_id,
             impressions = EXCLUDED.impressions,
             clicks = EXCLUDED.clicks,
             spend = EXCLUDED.spend,
             reach = EXCLUDED.reach,
             updated_at = NOW()`,
          [
            row.date_start,
            row.campaign_id,
            row.campaign_name,
            row.adset_id,
            row.ad_id || null,
            parseInt(row.impressions, 10) || 0,
            parseInt(row.clicks, 10) || 0,
            parseFloat(row.spend) || 0,
            parseInt(row.reach, 10) || 0,
          ],
        );
        upserted++;
      }

      console.log(`Meta Ads sync complete: ${upserted} rows upserted for ${dateStr}`);
    } catch (err) {
      console.error('Meta Ads cron job failed:', err);
    }
  });
}
