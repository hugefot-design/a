/**
 * En liten programvare-autentikator (passkey) for testene: lager en P-256-nøkkel, svarer på
 * registrering (attestasjon «none») og signerer innlogginger slik en ekte enhet gjør.
 * Bare for tester – ingen ekte enhet eller nettleser trengs.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const b64url = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

// Minimal CBOR (heltall, tekst, bytes, map) – nok for attestasjon og COSE-nøkkel.
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
function cbor(value: unknown): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    const parts = [head(5, value.size)];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Buffer.concat(parts);
  }
  throw new Error('cbor: ukjent type');
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  signCount = 0;

  constructor(
    readonly origin: string,
    readonly rpId = new URL(origin).hostname,
  ) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private coseKey(): Buffer {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return cbor(
      new Map<number, unknown>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
  }

  private authData(flags: number, withCredential: boolean, rpId = this.rpId): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.signCount);
    const parts: Buffer[] = [sha256(rpId), Buffer.from([flags]), count];
    if (withCredential) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.coseKey());
    }
    return Buffer.concat(parts);
  }

  /** Svar på registreringsvalg fra serveren (som startRegistration() i nettleseren). */
  register(options: { challenge: string }, opts: { origin?: string } = {}) {
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const attestation = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(UP | UV | AT, true)]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ['internal'] },
    };
  }

  /** Svar på innloggingsvalg (som startAuthentication()). `origin` kan settes for å etterligne en falsk side. */
  authenticate(options: { challenge: string }, opts: { origin?: string; rpId?: string; keepCount?: boolean } = {}) {
    if (!opts.keepCount) this.signCount += 1;
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const authData = this.authData(UP | UV, false, opts.rpId);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(signature) },
    };
  }
}
