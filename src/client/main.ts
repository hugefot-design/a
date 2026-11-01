/*
 * Liten progressiv forbedring. Alt fungerer uten JavaScript; skriptet gjør
 * enkelte handlinger raskere (bokmerker, autolagring) og legger til bekreftelser.
 */

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
  // Lukk åpne menyer når man klikker utenfor.
  document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((d) => {
    if (!d.contains(event.target as Node) && !d.dataset.keepOpen) d.open = false;
  });
});

// Kopier til utklippstavle.
document.addEventListener('click', async (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy ?? '');
    const old = btn.textContent;
    btn.textContent = 'Kopiert';
    setTimeout(() => (btn.textContent = old), 1500);
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
