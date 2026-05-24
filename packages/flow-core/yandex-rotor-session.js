'use strict'

const axios = require('axios')

const YM_BASE = 'https://api.music.yandex.net'
const YM_MY_WAVE_STATION = 'user:onyourwave'

function extractYandexOAuthToken(raw) {
  const t = String(raw || '').trim()
  const extracted = t.match(/access_token=([^&#]+)/)
  const decoded = extracted ? decodeURIComponent(extracted[1]) : t
  return decoded.trim()
}

function ymRotorSessionHeaders(oauth) {
  return {
    Authorization: `OAuth ${oauth}`,
    'X-Yandex-Music-Client': 'YandexMusicDesktop/5.42.2',
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

function ymRotorIsoTimestamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const tz = -d.getTimezoneOffset()
  const sign = tz >= 0 ? '+' : '-'
  const abs = Math.abs(tz)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function mapFlowWaveModeToYmMoodEnergy(mode) {
  const m = {
    default: 'all',
    sad: 'sad',
    happy: 'fun',
    energetic: 'active',
    calm: 'calm',
    romantic: 'fun',
  }
  return m[String(mode || '').trim()] || 'all'
}

function mapFlowWaveModeToYmSeeds(mode) {
  const mood = mapFlowWaveModeToYmMoodEnergy(mode)
  if (!mood || mood === 'all') return [YM_MY_WAVE_STATION]
  return [YM_MY_WAVE_STATION, `mood:${mood}`]
}

function extractTrackId(track) {
  const raw = String(track?.id ?? '').trim()
  if (!raw) return null
  if (!raw.includes(':')) return raw
  return raw.split(':')[0].trim() || raw
}

function mapYmRotorTrackToFlow(t, batchId, station, radioSessionId) {
  if (!t || typeof t !== 'object') return null
  const id = extractTrackId(t)
  if (!id) return null
  const sessionBatchId = String(batchId || '').trim()
  return {
    title: String(t.title || '').trim() || 'Без названия',
    artist: Array.isArray(t.artists) ? t.artists.map((a) => a?.name).filter(Boolean).join(', ') : '—',
    url: null,
    cover: t.coverUri ? 'https://' + String(t.coverUri).replace('%%', '300x300') : null,
    bg: 'linear-gradient(135deg,#fc3f1d,#ff6534)',
    source: 'yandex',
    id: String(id),
    duration_ms: Number(t.durationMs || 0) || undefined,
    yandexRotor: {
      batchId: sessionBatchId,
      sessionBatchId,
      station: String(station || YM_MY_WAVE_STATION),
      radioSessionId: String(radioSessionId || ''),
    },
  }
}

function parseYmRotorSessionBody(body) {
  const res = body?.result != null ? body.result : body
  if (!res || typeof res !== 'object') return null
  const radioSessionId = String(res.radioSessionId || res.radio_session_id || '').trim()
  const batchId = String(res.batchId || res.batch_id || '').trim()
  const sequence = Array.isArray(res.sequence) ? res.sequence : []
  const tracks = []
  for (const item of sequence) {
    const typ = String(item?.type || '').toLowerCase()
    if (typ !== 'track' || !item?.track) continue
    const itemBatch = String(item.batchId || item.batch_id || batchId || '').trim()
    const row = mapYmRotorTrackToFlow(item.track, itemBatch, YM_MY_WAVE_STATION, radioSessionId)
    if (row) tracks.push(row)
  }
  const batchAnchorId = tracks.length ? String(tracks[0].id || '').trim() : ''
  const desc = res.descriptionSeed || res.description_seed || null
  let radioStartedFrom = 'radio-mobile-user-onyourwave-default'
  if (desc && typeof desc === 'object') {
    const typ = String(desc.type || 'user').trim() || 'user'
    const tag = String(desc.tag || 'onyourwave').trim() || 'onyourwave'
    radioStartedFrom = `radio-mobile-${typ}-${tag}-default`
  }
  const lastTrack = tracks.length ? tracks[tracks.length - 1] : null
  return {
    radioSessionId,
    batchId,
    tracks,
    batchAnchorId,
    radioStartedFrom,
    nextQueueTrackId: lastTrack?.id ? String(lastTrack.id) : batchAnchorId,
  }
}

async function ymRotorSessionNew(oauth, mode) {
  const r = await axios.post(
    `${YM_BASE}/rotor/session/new`,
    {
      seeds: mapFlowWaveModeToYmSeeds(mode),
      includeTracksInResponse: true,
      includeWaveModel: true,
      interactive: true,
    },
    { headers: ymRotorSessionHeaders(oauth), timeout: 28000, validateStatus: () => true },
  )
  if (r.data?.error) {
    return { ok: false, error: String(r.data.error?.message || r.data.error?.name || 'session/new') }
  }
  const parsed = parseYmRotorSessionBody(r.data)
  if (!parsed?.radioSessionId || !parsed.tracks.length) {
    return { ok: false, error: 'Яндекс волна: пустая сессия' }
  }
  return { ok: true, apiMode: 'session', ...parsed }
}

async function ymRotorSessionMoreTracks(oauth, radioSessionId, queueTrackIds = []) {
  const queue = (queueTrackIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  const r = await axios.post(
    `${YM_BASE}/rotor/session/${encodeURIComponent(radioSessionId)}/tracks`,
    { queue },
    { headers: ymRotorSessionHeaders(oauth), timeout: 28000, validateStatus: () => true },
  )
  if (r.data?.error) {
    return { ok: false, error: String(r.data.error?.message || r.data.error?.name || 'session/tracks') }
  }
  const parsed = parseYmRotorSessionBody(r.data)
  if (!parsed?.tracks?.length) return { ok: false, error: 'Яндекс волна: пустая пачка' }
  return { ok: true, apiMode: 'session', ...parsed }
}

async function ymRotorSessionFeedback(oauth, radioSessionId, batchId, type, fields = {}) {
  const event = { type: String(type || ''), timestamp: ymRotorIsoTimestamp() }
  if (fields.trackId != null) event.trackId = String(fields.trackId)
  if (fields.from) event.from = String(fields.from)
  if (fields.totalPlayedSeconds != null) event.totalPlayedSeconds = Number(fields.totalPlayedSeconds)
  const r = await axios.post(
    `${YM_BASE}/rotor/session/${encodeURIComponent(radioSessionId)}/feedback`,
    { event, batchId: String(batchId || '') },
    { headers: ymRotorSessionHeaders(oauth), timeout: 15000, validateStatus: () => true },
  )
  if (r.data?.error) return false
  return r.status >= 200 && r.status < 300
}

async function fetchYandexWavePack(token, opts = {}) {
  const oauth = extractYandexOAuthToken(token)
  if (!oauth) return { ok: false, error: 'Пустой токен Яндекса' }
  const resetSession = !!opts.resetSession
  const radioSessionId = String(opts.radioSessionId || '').trim()
  const batchAnchorId = String(opts.batchAnchorId || '').trim()
  const mode = opts.mode || 'default'

  if (resetSession || !radioSessionId) {
    const session = await ymRotorSessionNew(oauth, mode)
    if (!session.ok) return session
    try {
      await ymRotorSessionFeedback(oauth, session.radioSessionId, session.batchId, 'radioStarted', {
        from: session.radioStartedFrom,
      })
    } catch (_) {}
    return session
  }

  const queue = batchAnchorId ? [batchAnchorId] : []
  return ymRotorSessionMoreTracks(oauth, radioSessionId, queue)
}

async function sendYandexWaveFeedback(token, payload = {}) {
  const oauth = extractYandexOAuthToken(token)
  if (!oauth) return { ok: false, error: 'Пустой токен' }
  const radioSessionId = String(payload.radioSessionId || '').trim()
  const batchId = String(payload.batchId || payload.sessionBatchId || '').trim()
  if (!radioSessionId || !batchId) return { ok: false, error: 'Нет session/batch' }
  const ok = await ymRotorSessionFeedback(oauth, radioSessionId, batchId, payload.type, {
    trackId: payload.trackId,
    totalPlayedSeconds: payload.totalPlayedSeconds,
    from: payload.from,
  })
  return { ok: Boolean(ok) }
}

module.exports = {
  extractYandexOAuthToken,
  fetchYandexWavePack,
  sendYandexWaveFeedback,
  mapFlowWaveModeToYmMoodEnergy,
}
