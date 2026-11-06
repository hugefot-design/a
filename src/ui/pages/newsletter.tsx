/** Avmelding fra ukesbrevet: en knapp, så e-postprogrammer som åpner lenker ikke melder deg av ved et uhell. */
import { buttonVariants } from '../components';
import { AuthLayout } from '../layouts';

export function NewsletterUnsubscribePage({ action, topic }: { action: string; topic: string }) {
  return (
    <AuthLayout title="Meld av Ukens anbud" intro={`Gjelder ukesbrevet ${topic}. Adressen slettes fra listen.`}>
      <form method="post" action={action}>
        <button type="submit" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          Meld meg av
        </button>
      </form>
    </AuthLayout>
  );
}
