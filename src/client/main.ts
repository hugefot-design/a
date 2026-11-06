/*
 * Liten progressiv forbedring. Alt fungerer uten JavaScript; skriptet gjør
 * enkelte handlinger raskere (bokmerker, autolagring) og legger til bekreftelser.
 */

import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';

function csrfToken(form?: HTMLFormElement | null): string {
  const input = (form ?? document).querySelector<HTMLInputElement>('input[name="_csrf"]');
  return input?.value ?? '';
}

// Bekreft destruktive handlinger.
document.addEventListener(
  'submit',
  (event) => {
    const form = event.target as HTMLFormElement;
    const message = form.dataset.confirm;
    if (message && !window.confirm(message)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (form.dataset.bookmark !== undefined) return;
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter && form.method.toLowerCase() === 'post' && !form.dataset.noBusy) {
      // Vent ett tick så knappens verdi blir sendt med før den deaktiveres visuelt.
      setTimeout(() => submitter.setAttribute('data-busy', 'true'), 0);
    }
  },
  true,
);

// Bokmerke uten sideinnlasting.
document.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement;
  if (form.dataset.bookmark === undefined) return;
  event.preventDefault();
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  button.disabled = true;
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-csrf-token': csrfToken(form) },
      body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>),
    });
    const data = (await res.json()) as { bookmarked?: boolean; error?: string };
    if (!res.ok) {
      window.alert(data.error ?? 'Kunne ikke lagre. Prøv igjen.');
      return;
    }
    const saved = Boolean(data.bookmarked);
    button.setAttribute('aria-pressed', String(saved));
    const label = button.querySelector('[data-label]');
    if (label) label.textContent = saved ? 'Lagret' : 'Lagre';
    button.title = saved ? 'Fjern fra lagrede anbud' : 'Lagre anbudet';
  } catch {
    window.alert('Nettverksfeil. Prøv igjen.');
  } finally {
    button.disabled = false;
  }
});

// Send skjema automatisk ved endring (f.eks. bytte organisasjon, sortering).
document.addEventListener('change', (event) => {
  const el = event.target as HTMLElement;
  if (el instanceof HTMLSelectElement && el.dataset.autosubmit !== undefined) el.form?.requestSubmit();
});

// Vis/skjul paneler (filtre på mobil).
document.addEventListener('click', (event) => {
  const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
  if (trigger) {
    const target = document.querySelector<HTMLElement>(trigger.dataset.toggle!);
    if (target) {
      const open = target.dataset.open !== 'true';
      target.dataset.open = String(open);
      trigger.setAttribute('aria-expanded', String(open));
    }
    return;
  }
  // Mørk bakgrunn bak mobilmenyen: et klikk lukker menyen.
  const closer = (event.target as HTMLElement).closest<HTMLElement>('[data-close-details]');
  if (closer) {
    const parent = closer.closest('details');
    if (parent) parent.open = false;
    return;
  }
  // Lukk åpne menyer når man klikker utenfor.
  document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((d) => {
    if (!d.contains(event.target as Node) && !d.dataset.keepOpen) d.open = false;
  });
});

// Kopier til utklippstavle. Har knappen et ikon, byttes bare teksten i [data-label].
document.addEventListener('click', async (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy ?? '');
    const target = btn.querySelector<HTMLElement>('[data-label]') ?? btn;
    const old = target.textContent;
    target.textContent = 'Kopiert';
    setTimeout(() => (target.textContent = old), 1500);
  } catch {
    /* ignorer */
  }
});

// Autolagring av tekstfelt i tilbudsarbeid.
document.querySelectorAll<HTMLTextAreaElement>('textarea[data-autosave-url]').forEach((area) => {
  let timer: number | undefined;
  let lastSaved = area.value;
  const status = document.getElementById(area.dataset.statusId ?? '');
  const save = async () => {
    if (area.value === lastSaved) return;
    const value = area.value;
    if (status) status.textContent = 'Lagrer …';
    try {
      const res = await fetch(area.dataset.autosaveUrl!, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrfToken(area.form) },
        body: new URLSearchParams({ content: value, _csrf: csrfToken(area.form) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      lastSaved = value;
      if (status) status.textContent = 'Lagret';
    } catch {
      if (status) status.textContent = 'Ikke lagret – sjekk nettverket';
    }
  };
  area.addEventListener('input', () => {
    window.clearTimeout(timer);
    if (status) status.textContent = 'Ulagrede endringer';
    timer = window.setTimeout(save, 1500);
  });
  area.addEventListener('blur', () => void save());
});

// Telle tegn i tekstfelt med maks lengde.
document.querySelectorAll<HTMLTextAreaElement>('textarea[data-count]').forEach((area) => {
  const out = document.getElementById(area.dataset.count!);
  const update = () => {
    if (out) out.textContent = `${area.value.length} / ${area.maxLength}`;
  };
  area.addEventListener('input', update);
  update();
});

// Diagrammer: vis verdien for søylen under pekeren (eller fingeren), og la piltastene bla mellom
// søylene når diagrammet har fokus. Tabellen under hvert diagram har de samme tallene, så dette
// er bare en snarvei. Teksten settes med textContent – aldri som HTML.
(() => {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  const value = document.createElement('strong');
  const label = document.createElement('span');
  tip.append(value, label);
  let active: HTMLElement | null = null;

  function show(slot: HTMLElement) {
    const [v = '', l = ''] = (slot.dataset.tip ?? '').split('|');
    if (!tip.isConnected) document.body.append(tip);
    active?.removeAttribute('data-active');
    active = slot;
    slot.setAttribute('data-active', '');
    value.textContent = v;
    label.textContent = l;
    tip.hidden = false;
    const r = slot.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${top + window.scrollY}px`;
  }
  function hide() {
    active?.removeAttribute('data-active');
    active = null;
    tip.hidden = true;
  }
  const slotFrom = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-chart] [data-tip]') : null);

  document.addEventListener('pointerover', (event) => {
    const slot = slotFrom(event.target);
    if (slot) show(slot);
  });
  document.addEventListener('pointerout', (event) => {
    const slot = slotFrom(event.target);
    if (slot && !slot.contains(event.relatedTarget as Node | null)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const chart = event.target instanceof HTMLElement && event.target.matches('[data-chart]') ? event.target : null;
    const slots = chart?.querySelectorAll<HTMLElement>('[data-tip]');
    if (slots?.length) show(slots[slots.length - 1]!);
  });
  document.addEventListener('focusout', (event) => {
    if (event.target instanceof HTMLElement && event.target.matches('[data-chart]')) hide();
  });
  document.addEventListener('keydown', (event) => {
    const chart = event.target instanceof HTMLElement && event.target.matches('[data-chart]') ? event.target : null;
    if (!chart) return;
    const slots = Array.from(chart.querySelectorAll<HTMLElement>('[data-tip]'));
    if (!slots.length) return;
    const index = active ? slots.indexOf(active) : slots.length - 1;
    const next =
      event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? slots.length - 1 : null;
    if (event.key === 'Escape') return hide();
    if (next === null) return;
    event.preventDefault();
    show(slots[Math.min(Math.max(next, 0), slots.length - 1)]!);
  });
  window.addEventListener('scroll', hide, { passive: true });
})();

// ---------------------------------------------------------------------------
// Totrinn: stor kodeboks og passkeys (Face ID / fingeravtrykk / sikkerhetsnøkkel).
// ---------------------------------------------------------------------------
// Kodeboksen tar bare sifre (også limt inn med mellomrom) og sender skjemaet når seks er skrevet.
document.querySelectorAll<HTMLInputElement>('input[data-code-autosubmit]').forEach((input) => {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value !== digits) input.value = digits;
    const form = input.form;
    if (digits.length === 6 && form && form.dataset.sending !== 'true') {
      form.dataset.sending = 'true';
      form.requestSubmit(form.querySelector<HTMLButtonElement>('button[type="submit"]') ?? undefined);
    }
  });
});
// Et skjema med kode sendes bare én gang (ellers kan samme kode brukes to ganger og avvises).
document.addEventListener(
  'submit',
  (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.querySelector('input[data-code-autosubmit]')) return;
    if (form.dataset.sent === 'true') event.preventDefault();
    else if (!event.defaultPrevented) form.dataset.sent = 'true';
  },
  true,
);

// Tilbake-knappen kan vise siden fra hurtigbufferen: skjemaene skal kunne sendes igjen.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  document.querySelectorAll<HTMLFormElement>('form[data-sent], form[data-sending]').forEach((form) => {
    delete form.dataset.sent;
    delete form.dataset.sending;
  });
  document.querySelectorAll<HTMLElement>('[data-busy]').forEach((el) => el.removeAttribute('data-busy'));
});

(() => {
  const supported = browserSupportsWebAuthn();
  const failText = (err: unknown, fallback: string) => {
    if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'Denne enheten er allerede lagt til.';
    if (err instanceof Error && err.name === 'ServerMessage') return err.message;
    return fallback;
  };
  const showError = (el: HTMLElement | null, text?: string) => {
    if (!el) return;
    if (text) el.textContent = text;
    el.hidden = false;
  };

  // Bekreft med passkey (innlogging og «bekreft at det er deg»). Valgene ligger i data-passkey-auth.
  document.querySelectorAll<HTMLFormElement>('form[data-passkey-auth]').forEach((form) => {
    if (!supported) return;
    form.hidden = false;
    const button = form.querySelector<HTMLButtonElement>('[data-passkey-start]');
    const error = form.querySelector<HTMLElement>('[data-passkey-error]');
    const field = form.querySelector<HTMLInputElement>('input[name="passkey"]');
    button?.addEventListener('click', async () => {
      if (!field || button.dataset.busy === 'true') return;
      if (error) error.hidden = true;
      button.setAttribute('data-busy', 'true');
      try {
        const optionsJSON = JSON.parse(form.dataset.passkeyAuth ?? '{}');
        field.value = JSON.stringify(await startAuthentication({ optionsJSON }));
        form.submit();
      } catch (err) {
        button.removeAttribute('data-busy');
        showError(error, failText(err, error?.textContent ?? ''));
      }
    });
  });

  // Legg til passkey: hent valg fra serveren, spør enheten, send svaret med skjemaet.
  document.querySelectorAll<HTMLFormElement>('form[data-passkey-register]').forEach((form) => {
    if (!supported) return;
    form.hidden = false;
    document.querySelectorAll<HTMLElement>('[data-passkey-unsupported]').forEach((el) => (el.hidden = true));
    const error = form.querySelector<HTMLElement>('[data-passkey-error]');
    const field = form.querySelector<HTMLInputElement>('input[name="response"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!field || !button || button.dataset.registering === 'true') return;
      button.dataset.registering = 'true';
      if (error) error.hidden = true;
      try {
        const res = await fetch(form.dataset.passkeyRegister!, {
          method: 'POST',
          headers: { Accept: 'application/json', 'x-csrf-token': csrfToken(form) },
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; stepUp?: string };
        if (data.stepUp) {
          window.location.href = data.stepUp;
          return;
        }
        if (!res.ok) throw Object.assign(new Error(data.error ?? 'Noe gikk galt. Last inn siden og prøv igjen.'), { name: 'ServerMessage' });
        field.value = JSON.stringify(await startRegistration({ optionsJSON: data as never }));
        form.submit();
      } catch (err) {
        delete button.dataset.registering;
        // Vent til «jobber»-markeringen fra innsendingen er satt, og fjern den.
        setTimeout(() => button.removeAttribute('data-busy'), 0);
        showError(error, failText(err, 'Avbrutt, eller enheten svarte ikke. Prøv igjen.'));
      }
    });
  });
})();

// ---------------------------------------------------------------------------
// Nettsiden: toppmenyen strammes inn ved rulling, seksjoner glir inn, tall teller opp.
// Alt innhold er synlig uten JavaScript; dette er bare pynt.
// ---------------------------------------------------------------------------
(() => {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = document.querySelectorAll<HTMLElement>('.reveal');
  if (!items.length || !('IntersectionObserver' in window)) return;

  const countUp = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count);
      const finalText = el.textContent ?? '';
      if (!Number.isFinite(target) || target <= 0 || reduce) return;
      const fmt = new Intl.NumberFormat(document.documentElement.lang || 'nb');
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1200);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = t < 1 ? fmt.format(Math.round(target * eased)) : finalText;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };

  document.documentElement.classList.add('reveal-ready');
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.classList.add('is-in');
        countUp(el);
        io.unobserve(el);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );
  items.forEach((el) => io.observe(el));
})();
