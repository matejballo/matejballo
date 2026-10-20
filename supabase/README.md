# SAUNIČKA · nastavení databáze

Appka běží na `matejballo.com/sauna`, data jsou v Supabase (free tier).

1. **Projekt.** Na supabase.com založ projekt (region Frankfurt).
2. **Tabulky.** SQL Editor → New query → vlož celý `schema.sql` → Run.
   Vytvoří tabulky, oprávnění, partu a import sezóny Jaro 2026 (vedenou jako zaplacenou).
3. **Zakázat registraci.** Authentication → Sign In / Providers → vypnout *Allow new users to sign up*.
   Účty zakládá jen skript níže.
4. **Napojit appku.** Project Settings → API → zkopíruj *Project URL* a *anon / publishable* klíč
   do `sauna/config.js`.
5. **Účty a PINy.** V terminálu (service role klíč nikam neukládej):
   ```bash
   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/sauna-users.mjs
   ```
   Vypíše 6místný PIN pro každého. Nový PIN: `... node scripts/sauna-users.mjs reset terka`.
6. **Účet pro platby.** V appce Admin → *Kam se platí* → číslo účtu (`123456789/0800` nebo IBAN).

## Jak to funguje
- Každý zapisuje jen sebe (max. týden dopředu, jen v otevřené sezóně). Admin zapisuje kohokoliv.
- Účast = 160 Kč (nastavitelné u sezóny). Dluh se sčítá průběžně, na konci sezóny dá admin
  *Uzavřít sezónu* a všem se ukáže finální částka s QR platbou.
- Hosty přidává admin; platí sami, nebo se připíšou tomu, kdo je přivedl.
