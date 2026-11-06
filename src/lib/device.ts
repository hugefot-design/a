/**
 * Enkel beskrivelse av enheten fra nettleserens User-Agent, f.eks. «Chrome på Windows».
 * Brukes i sikkerhetsvarsler og som forslag til navn på en passkey. Ikke til sporing:
 * teksten lagres ikke utover e-posten og navnet brukeren selv kan endre.
 */
export interface DeviceInfo {
  os: string | null;
  browser: string | null;
  /** «Chrome på Windows», «Safari på iPhone» eller «Ukjent enhet». */
  label: string;
}

const OS_RULES: [RegExp, string][] = [
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Android/i, 'Android'],
  [/CrOS/i, 'Chromebook'],
  [/Windows/i, 'Windows'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/Linux/i, 'Linux'],
];

// Rekkefølgen betyr noe: Edge, Opera og Samsung sier også «Chrome», og Chrome sier også «Safari».
const BROWSER_RULES: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/Firefox\/|FxiOS/i, 'Firefox'],
  [/Chrome\/|CriOS/i, 'Chrome'],
  [/Safari\//i, 'Safari'],
];

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? '').slice(0, 400);
  const os = OS_RULES.find(([re]) => re.test(ua))?.[1] ?? null;
  const browser = BROWSER_RULES.find(([re]) => re.test(ua))?.[1] ?? null;
  const label = browser && os ? `${browser} på ${os}` : (browser ?? os ?? 'Ukjent enhet');
  return { os, browser, label };
}

/** Forslag til navn på en ny passkey: enheten den lages på. */
export function suggestPasskeyName(userAgent: string | null | undefined): string {
  const { os } = describeDevice(userAgent);
  return os ? (os === 'Windows' || os === 'Linux' ? `${os}-PC` : os) : 'Min enhet';
}
