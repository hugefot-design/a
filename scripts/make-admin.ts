/**
 * Gir (eller fjerner) plattform-admin for en registrert bruker.
 *   npm run make-admin -- person@firma.no
 *   npm run make-admin -- person@firma.no --remove
 */
import { closeDb } from '../src/lib/db';
import { setPlatformAdmin } from '../src/domain/auth/auth';
import { audit } from '../src/lib/audit';

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Bruk: npm run make-admin -- <e-post> [--remove]');
    process.exit(2);
  }
  const value = !process.argv.includes('--remove');
  const ok = await setPlatformAdmin(email, value);
  if (!ok) {
    console.error(`Fant ingen bruker med e-post ${email}. Registrer brukeren i appen først.`);
    process.exitCode = 1;
    return;
  }
  await audit({ action: 'admin.role_changed', targetType: 'user', metadata: { email, isPlatformAdmin: value, via: 'cli' } });
  console.log(value ? `${email} er nå plattform-admin.` : `${email} er ikke lenger plattform-admin.`);
}

main().finally(() => closeDb());
