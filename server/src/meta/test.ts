/**
 * Teste manual do cliente da API Meta contra a API real.
 * Uso: npm run test:meta
 *
 * Lista as contas (com paginação) e busca os gastos dos últimos 7 dias
 * da primeira conta, para validar credenciais, paginação e insights.
 */
import { assertMetaConfig } from '../config/index.js';
import { listAdAccounts, getDailySpend } from './client.js';
import { accountStatusLabel } from './accountStatus.js';

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  assertMetaConfig();

  console.log('== Listando contas de anúncio ==');
  const accounts = await listAdAccounts();

  console.log(`\nResumo (${accounts.length} contas):`);
  for (const a of accounts.slice(0, 10)) {
    const cap = a.spendCap == null ? 'Sem limite' : a.spendCap.toFixed(2);
    const pct = a.pctUsed == null ? '-' : `${a.pctUsed.toFixed(1)}%`;
    console.log(
      `  ${a.id} | ${a.name} | ${accountStatusLabel(a.status)} | ` +
        `${a.currency} | limite ${cap} | gasto ${a.amountSpent.toFixed(2)} | usado ${pct}`,
    );
  }
  if (accounts.length > 10) console.log(`  ... e mais ${accounts.length - 10} contas.`);

  if (accounts.length > 0) {
    const until = new Date();
    const since = new Date();
    since.setDate(since.getDate() - 6);
    const first = accounts[0];
    console.log(`\n== Gastos diários (últimos 7 dias) de ${first.id} (${first.name}) ==`);
    const daily = await getDailySpend(first.id, fmtDate(since), fmtDate(until));
    if (daily.length === 0) {
      console.log('  (sem gastos no período)');
    } else {
      for (const d of daily) {
        console.log(`  ${d.date}: ${d.spend.toFixed(2)} ${first.currency}`);
      }
    }
  }

  console.log('\n✔ Teste concluído com sucesso.');
}

main().catch((err) => {
  console.error('\n[X] Teste falhou:', err.message);
  process.exit(1);
});
