// The only place the arcade voice tools talk to ElevenLabs.
//
// Privacy: the key is read at run time by lib/voice.js loadKey() (environment, then the env
// file named by BIRDIE_VOICE_ENV, then a git-ignored .env in the repo root), sent ONLY in the
// xi-api-key header to api.elevenlabs.io, never printed and never written. The requests
// carry the line text (or sound prompt) and the voice settings, nothing else: no user
// name, no e-mail, no project or machine details.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadKey, API_ORIGIN } = require('../../lib/voice.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ElevenError extends Error {
  constructor(status, code, message) {
    super(`ElevenLabs ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`);
    this.status = status;
    this.code = code || '';
  }
}

export function createClient({ concurrency = 2, log = () => {} } = {}) {
  const key = loadKey();
  if (!key) throw new Error('No ELEVENLABS_API_KEY (environment, the env file named by BIRDIE_VOICE_ENV, or a .env file in the repo root: see .env.example).');

  // a tiny semaphore: the account's concurrency limit is small
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve) => {
    if (active < concurrency) { active++; resolve(); } else waiting.push(resolve);
  });
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

  async function request(method, path, { body, accept } = {}) {
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          res = await fetch(`${API_ORIGIN}${path}`, {
            method,
            headers: {
              'xi-api-key': key,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
              ...(accept ? { Accept: accept } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(90000),
          });
        } catch (err) {
          if (attempt >= 4) throw new ElevenError(0, 'network', err && err.name === 'TimeoutError' ? 'timed out' : 'network error');
          await sleep(1500 * 2 ** attempt);
          continue;
        }
        if (res.ok) return res;
        let code = '';
        let message = '';
        try {
          const j = await res.json();
          const d = j && j.detail;
          if (d && typeof d === 'object') { code = String(d.status || d.code || ''); message = String(d.message || ''); }
          else if (typeof d === 'string') message = d;
        } catch (_) { /* no JSON body */ }
        const busy = res.status === 429 && !/quota/i.test(code);
        if ((busy || res.status >= 500) && attempt < 6) {
          const ra = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(ra) && ra > 0 ? Math.min(60, ra) * 1000 : Math.min(30000, 1500 * 2 ** attempt);
          log(`  (${res.status}${code ? ` ${code}` : ''}: waiting ${Math.round(wait / 1000)} s)`);
          await sleep(wait);
          continue;
        }
        throw new ElevenError(res.status, code, message.slice(0, 200));
      }
    } finally {
      release();
    }
  }

  return {
    /** { tier, used, limit } or null when the key may not read it. */
    async subscription() {
      try {
        const j = await (await request('GET', '/v1/user/subscription')).json();
        return { tier: j.tier, used: j.character_count, limit: j.character_limit };
      } catch (_) { return null; }
    },

    /** { id, name, labels, category }; null when the voice is not on the account; undefined when the key may not look. */
    async voice(id) {
      try {
        const j = await (await request('GET', `/v1/voices/${encodeURIComponent(id)}`)).json();
        return { id: j.voice_id, name: j.name, labels: j.labels || {}, category: j.category, description: j.description || '' };
      } catch (err) {
        if (!(err instanceof ElevenError)) throw err;
        if (/missing_permissions/.test(err.code)) return undefined;   // a key scoped to speech only
        if (err.status === 404 || err.status === 400 || /voice_not_found/.test(err.code)) return null;
        throw err;
      }
    },

    async voices() {
      const j = await (await request('GET', '/v2/voices?page_size=100')).json();
      return (j.voices || []).map((v) => ({
        id: v.voice_id, name: v.name, labels: v.labels || {}, category: v.category, description: v.description || '',
      }));
    },

    /**
     * Text to speech. Returns { bytes, format, characters }. `format` is tried as given:
     * the caller walks down its own preference list on a 4xx about the format.
     */
    async speak({ voiceId, text, model, settings, format }) {
      const res = await request('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`, {
        body: { text, model_id: model, voice_settings: settings },
        accept: format.startsWith('mp3') ? 'audio/mpeg' : '*/*',
      });
      const cost = Number(res.headers.get('character-cost'));
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        format,
        characters: Number.isFinite(cost) && cost > 0 ? cost : text.length,
      };
    },

    /** Text to sound effect. Returns { bytes, format }. */
    async sound({ text, seconds, influence = 0.4, format = 'mp3_44100_128' }) {
      const res = await request('POST', `/v1/sound-generation?output_format=${encodeURIComponent(format)}`, {
        body: { text, duration_seconds: seconds, prompt_influence: influence },
        accept: 'audio/mpeg',
      });
      const cost = Number(res.headers.get('character-cost'));
      return { bytes: Buffer.from(await res.arrayBuffer()), format, credits: Number.isFinite(cost) ? cost : null };
    },

    /** Speech to text of one of OUR OWN rendered clips (a content check). Returns the transcript. */
    async transcribe(mp3Bytes) {
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      form.append('language_code', 'en');
      form.append('tag_audio_events', 'false');
      form.append('file', new Blob([mp3Bytes], { type: 'audio/mpeg' }), 'clip.mp3');
      await acquire();
      try {
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`${API_ORIGIN}/v1/speech-to-text`, {
            method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(90000),
          }).catch(() => null);
          if (res && res.ok) return String((await res.json()).text || '');
          if (attempt < 4 && (!res || res.status === 429 || res.status >= 500)) { await sleep(2000 * 2 ** attempt); continue; }
          throw new ElevenError(res ? res.status : 0, 'stt', 'transcription failed');
        }
      } finally { release(); }
    },
  };
}
