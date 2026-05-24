'use strict'

const axios = require('axios')
const {
  parseYandexPlaylistRef,
  parseYandexAlbumId,
  parseVkPlaylistRef,
} = require('../../src/modules/utils/parsers')
const flowYandex = require('./providers/yandex')
const flowVk = require('./providers/vk')

const YM_BASE = 'https://api.music.yandex.net'

function ymHeaders(token) {
  const oauth = flowYandex.extractYandexOAuthToken(token)
  return flowYandex.yandexApiHeaders(oauth)
}

function extractYandexTrackId(track = {}, row = {}) {
  const rawId = track?.id != null ? track.id : row?.trackId != null ? row.trackId : row?.id
  const value = String(rawId ?? '').trim()
  if (!value) return null
  if (!value.includes(':')) return value
  return value.split(':')[0].trim() || value
}

function mapYandexRows(tracks = []) {
  const out = []
  for (const row of tracks) {
    if (row && typeof row === 'object' && row.error) continue
    const t = row?.track || row
    if (!t?.title) continue
    const id = extractYandexTrackId(t, row)
    if (!id) continue
    out.push({
      title: String(t.title || '').trim(),
      artist: Array.isArray(t.artists) ? t.artists.map((a) => a?.name).filter(Boolean).join(', ') : '—',
      cover: t.coverUri ? 'https://' + String(t.coverUri).replace('%%', '300x300') : null,
      source: 'yandex',
      id: String(id),
    })
  }
  return out.filter((x) => x.title)
}

function mapYandexObjects(tracks = []) {
  const out = []
  for (const t of tracks) {
    if (!t || typeof t !== 'object' || t.error || !t.title) continue
    const id = extractYandexTrackId(t, t)
    if (!id) continue
    out.push({
      title: String(t.title || '').trim(),
      artist: Array.isArray(t.artists) ? t.artists.map((a) => a?.name).filter(Boolean).join(', ') : '—',
      cover: t.coverUri ? 'https://' + String(t.coverUri).replace('%%', '300x300') : null,
      source: 'yandex',
      id: String(id),
    })
  }
  return out
}

function flattenAlbum(result = {}) {
  const out = []
  const push = (item) => {
    const t = item?.track || item
    if (!t?.title) return
    const id = extractYandexTrackId(t, item)
    if (!id) return
    out.push({
      title: String(t.title || '').trim(),
      artist: Array.isArray(t.artists) ? t.artists.map((a) => a?.name).filter(Boolean).join(', ') : '—',
      cover: t.coverUri ? 'https://' + String(t.coverUri).replace('%%', '300x300') : null,
      source: 'yandex',
      id: String(id),
    })
  }
  const volumes = Array.isArray(result.volumes) ? result.volumes : []
  for (const vol of volumes) {
    if (Array.isArray(vol)) vol.forEach(push)
    else if (vol && Array.isArray(vol.tracks)) vol.tracks.forEach(push)
  }
  if (!out.length && Array.isArray(result.tracks)) result.tracks.forEach(push)
  return out
}

async function getYandexUid(headers) {
  const r = await axios.get(`${YM_BASE}/account/settings`, { headers, timeout: 12000, validateStatus: () => true })
  const res = r.data?.result
  if (!res || typeof res !== 'object') return null
  if (res.uid != null) return String(res.uid).trim()
  if (typeof res.login === 'string' && res.login.trim()) return res.login.trim()
  return null
}

async function fetchYandexTracksByIds(headers, trackIds) {
  const ids = (Array.isArray(trackIds) ? trackIds : []).filter(Boolean)
  if (!ids.length) return []
  const merged = []
  const chunkSize = 150
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const form = new URLSearchParams()
    form.append('with-positions', 'true')
    for (const id of chunk) form.append('track-ids', String(id))
    const r = await axios.post(`${YM_BASE}/tracks`, form, {
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 35000,
      validateStatus: () => true,
    })
    const list = Array.isArray(r.data?.result) ? r.data.result : []
    merged.push(...mapYandexObjects(list))
  }
  return merged
}

function collectBatchIds(tracks = []) {
  const out = []
  const seen = new Set()
  for (const row of tracks) {
    if (!row || typeof row !== 'object' || row.error) continue
    if (row.track && row.track.title) continue
    let spec = null
    if (typeof row.id === 'string' && row.id.includes(':')) spec = row.id
    else {
      const tid = row.trackId != null ? row.trackId : row.id
      const aid = row.albumId != null ? row.albumId : null
      if (tid != null && aid != null) spec = `${tid}:${aid}`
      else if (tid != null) spec = String(tid)
    }
    if (spec && !seen.has(spec)) {
      seen.add(spec)
      out.push(spec)
    }
  }
  return out
}

async function fetchYandexPlaylist(headers, owner, kind) {
  const uid = encodeURIComponent(String(owner || '').trim())
  const k = encodeURIComponent(String(kind || '').trim())
  const load = (pl) => ({
    name: String(pl?.title || 'Плейлист'),
    tracks: mapYandexRows(Array.isArray(pl?.tracks) ? pl.tracks : []),
    pl,
  })

  const rRich = await axios.get(`${YM_BASE}/users/${uid}/playlists/${k}?rich-tracks=true`, {
    headers,
    timeout: 28000,
    validateStatus: () => true,
  })
  let { name, tracks, pl } = load(rRich.data?.result)
  if (tracks.length) return { name, tracks }

  const rPlain = await axios.get(`${YM_BASE}/users/${uid}/playlists/${k}`, {
    headers,
    timeout: 20000,
    validateStatus: () => true,
  })
  ;({ name, tracks, pl } = load(rPlain.data?.result))
  if (tracks.length) return { name, tracks }

  const batchIds = collectBatchIds(pl?.tracks || [])
  if (batchIds.length) {
    const fromBatch = await fetchYandexTracksByIds(headers, batchIds)
    if (fromBatch.length) return { name, tracks: fromBatch }
  }
  return { name, tracks: [] }
}

async function importYandexLink(link, token) {
  const headers = ymHeaders(token)
  const albumId = parseYandexAlbumId(link)
  if (albumId) {
    const r = await axios.get(`${YM_BASE}/albums/${encodeURIComponent(albumId)}/with-tracks`, {
      headers,
      timeout: 24000,
      validateStatus: () => true,
    })
    const result = r.data?.result || {}
    const tracks = flattenAlbum(result)
    if (!tracks.length) return { ok: false, error: 'В альбоме нет треков' }
    return { ok: true, service: 'yandex', name: String(result.title || `Альбом ${albumId}`), tracks }
  }

  const ref = parseYandexPlaylistRef(link)
  if (!ref) return { ok: false, error: 'Не удалось распознать ссылку Яндекс Музыки' }

  let owner = String(ref.user || '').trim()
  if (!owner || /^me$/i.test(owner)) {
    owner = await getYandexUid(headers)
    if (!owner) return { ok: false, error: 'Не удалось получить id аккаунта — проверь токен' }
  }

  const { name, tracks } = await fetchYandexPlaylist(headers, owner, ref.kind)
  if (!tracks.length) return { ok: false, error: 'Плейлист пуст или API не вернул треки' }
  return { ok: true, service: 'yandex', name, tracks }
}

function vkItems(body) {
  const r = body?.response
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.items)) return r.items
  if (Array.isArray(r?.audios)) return r.audios
  if (Array.isArray(r?.list)) return r.list
  return []
}

async function importVkLink(link, vkToken) {
  const ref = parseVkPlaylistRef(link)
  if (!ref) return { ok: false, error: 'Не удалось распознать ссылку VK' }
  const tok = String(vkToken || '').trim()
  if (!tok) return { ok: false, error: 'Нужен VK access_token' }

  const pById = {
    owner_id: String(ref.ownerId),
    playlist_id: String(ref.albumId),
    access_token: tok,
  }
  if (ref.accessKey) pById.access_key = String(ref.accessKey)

  const byId = await flowVk.vkInvokeKateMethod('audio.getPlaylistById', pById, 15000)
  if (!byId?.body?.error) {
    const r0 = Array.isArray(byId?.body?.response) ? byId.body.response[0] : byId?.body?.response || {}
    const rawRows = Array.isArray(r0?.audios) ? r0.audios : Array.isArray(r0?.list) ? r0.list : []
    const tracks = rawRows
      .map((t) => {
        const id = t?.owner_id && t?.id ? `${t.owner_id}_${t.id}` : String(t?.id || '')
        if (!id || !t?.title) return null
        return {
          title: t.title,
          artist: t?.artist || '—',
          cover: t?.album?.thumb?.photo_300 || t?.album?.thumb?.photo_270 || null,
          source: 'vk',
          id,
          url: t?.url || null,
        }
      })
      .filter(Boolean)
    if (tracks.length) {
      return { ok: true, service: 'vk', name: String(r0?.title || 'VK Playlist'), tracks }
    }
  }

  const params = {
    owner_id: String(ref.ownerId),
    album_id: String(ref.albumId),
    access_token: tok,
    count: '600',
  }
  if (ref.accessKey) params.access_key = String(ref.accessKey)
  const r = await flowVk.vkInvokeKateMethod('audio.get', params, 15000)
  if (r?.body?.error) return { ok: false, error: r.body.error.error_msg || 'VK API error' }
  const items = vkItems(r.body) || []
  const tracks = items
    .map((t) => {
      const id = t?.owner_id && t?.id ? `${t.owner_id}_${t.id}` : String(t?.id || '')
      if (!id || !t?.title) return null
      return {
        title: t.title,
        artist: t?.artist || '—',
        cover: t?.album?.thumb?.photo_300 || null,
        source: 'vk',
        id,
        url: t?.url || null,
      }
    })
    .filter(Boolean)
  if (!tracks.length) return { ok: false, error: 'VK плейлист пуст' }
  return { ok: true, service: 'vk', name: 'VK Playlist', tracks }
}

function importFlowJson(payload) {
  let data = payload
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload)
    } catch {
      return { ok: false, error: 'Неверный JSON' }
    }
  }
  const raw = Array.isArray(data) ? data : data?.playlists
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: 'Неверный формат (нужен flow-playlists-v1)' }
  }
  const playlists = raw
    .map((pl) => {
      const name = String(pl?.name || 'Плейлист').trim()
      const tracks = (Array.isArray(pl?.tracks) ? pl.tracks : [])
        .map((t) => ({
          title: String(t?.title || '').trim(),
          artist: String(t?.artist || '—').trim(),
          cover: t?.cover || t?.coverData || null,
          source: String(t?.source || 'yandex').toLowerCase(),
          id: String(t?.id || t?.original_id || ''),
          url: t?.url || null,
        }))
        .filter((t) => t.title && t.id)
      return { name, tracks, description: pl?.description || '' }
    })
    .filter((p) => p.name && p.tracks.length)
  if (!playlists.length) return { ok: false, error: 'В файле нет плейлистов с треками' }
  return { ok: true, service: 'nexory', playlists }
}

async function importPlaylist({ url, json, tokens = {} }) {
  if (json != null && json !== '') {
    return importFlowJson(json)
  }
  const link = String(url || '').trim()
  if (!link) return { ok: false, error: 'Укажите ссылку или JSON' }

  if (/^[\[{]/.test(link)) {
    return importFlowJson(link)
  }

  const isYandex = /(^|\/\/)(music\.)?yandex\./i.test(link) || /(^|\/\/)yandex\.[^/]+/i.test(link)
  if (isYandex) {
    const t = String(tokens.yandexToken || tokens.yandex || '').trim()
    if (!t) return { ok: false, error: 'Нужен yandexToken' }
    return importYandexLink(link, t)
  }

  const vkRef = parseVkPlaylistRef(link)
  if (vkRef) {
    return importVkLink(link, tokens.vkToken || tokens.vk)
  }

  return { ok: false, error: 'Поддерживаются ссылки VK, Яндекс Музыки и JSON из Nexory (ПК)' }
}

module.exports = { importPlaylist, importFlowJson }
