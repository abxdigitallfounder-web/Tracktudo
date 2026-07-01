import cron from 'node-cron';
import { config } from '../config/index.js';
import { collectLimitsJob, collectDailyJob } from '../services/collector.js';

/**
 * Inicia os jobs agendados:
 *  - Limites: CRON_LIMITS (padrão a cada 12h).
 *  - Gastos diários: CRON_DAILY_SPEND (padrão a cada 6h).
 * Em hosts que "dormem" (ex.: Render free), o cron só dispara enquanto o
 * serviço está acordado — por isso também recoletamos no boot (ver index.ts).
 */
export function startScheduler(): void {
  if (!cron.validate(config.cron.limits)) {
    console.error(`[Cron] Expressão inválida em CRON_LIMITS: "${config.cron.limits}"`);
  } else {
    cron.schedule(config.cron.limits, () => {
      console.log('[Cron] Disparando coleta de limites...');
      void collectLimitsJob();
    });
  }

  if (!cron.validate(config.cron.dailySpend)) {
    console.error(`[Cron] Expressão inválida em CRON_DAILY_SPEND: "${config.cron.dailySpend}"`);
  } else {
    cron.schedule(config.cron.dailySpend, () => {
      console.log('[Cron] Disparando coleta de gastos diários...');
      void collectDailyJob();
    });
  }

  console.log(
    `[Cron] Agendado — limites: "${config.cron.limits}", gastos: "${config.cron.dailySpend}".`,
  );
}
