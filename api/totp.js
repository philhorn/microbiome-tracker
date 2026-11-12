// Authenticator-app codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), no dependencies.
import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export const newSecret = () => {
    const bytes = crypto.randomBytes(20);
    let bits = '', out = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
    return out;
};

const decode = (secret) => {
    let bits = '';
    for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) {
        const v = ALPHABET.indexOf(c);
        if (v < 0) throw new Error('bad base32');
        bits += v.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
};

export const codeAt = (secret, step) => {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac('sha1', decode(secret)).update(msg).digest();
    const o = h[h.length - 1] & 0xf;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
};

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP);

// The step the code matches (one step of clock drift either way), or null. A step at or
// before lastStep was already used and is refused, so a code works only once.
export const verify = (secret, code, lastStep = 0, now = Date.now()) => {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return null;
    const c = Buffer.from(code.trim());
    const t = currentStep(now);
    for (const s of [t - 1, t, t + 1]) {
        if (s <= lastStep) continue;
        if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), c)) return s;
    }
    return null;
};

export const otpauthUri = (secret, account, issuer = 'Microbiome Tracker') =>
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
