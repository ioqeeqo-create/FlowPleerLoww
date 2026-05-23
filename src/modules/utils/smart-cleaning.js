(() => {
  const YEAR_TOKEN_RE = /\b(?:19|20)\d{2}\b/g
  const NOISE_BRACKETS_RE = /[\[(](?:official\s*(?:video|audio|lyrics?)|lyric\s*video|visualizer|hd|hq|4k|8k|remaster(?:ed)?|audio|video|prod\.?\s+by|explicit|clean|radio\s*edit|extended|full\s*version|original\s*version|music\s*box|music\s*in\s*(?:the\s+)?description|in\s+description|description\s+music)[^\])]*[\])]/gi
  const NOISE_WORD_RE = /\b(?:official|video|audio|lyrics?|lyric|visualizer|hq|hd|4k|8k|remaster(?:ed)?|explicit|clean|full\s*version|original\s*version|music\s*box)\b/gi
  const STAR_CHUNK_RE = /\*[^*]{1,80}\*/g
  const TAIL_JUNK_RE = /\s*(?:[-–—|]\s*)?(?:original\s+version|music\s+in\s+(?:the\s+)?description|in\s+description|description\s+music|music\s+box)\s*$/i

  function smartCleanTrackTitle(title) {
    return String(title || '')
      .replace(STAR_CHUNK_RE, ' ')
      .replace(NOISE_BRACKETS_RE, ' ')
      .replace(YEAR_TOKEN_RE, ' ')
      .replace(NOISE_WORD_RE, ' ')
      .replace(/@[\w.-]{2,}/g, ' ')
      .replace(/[_|]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  /** Короткий заголовок для плеера: сначала чистка SEO-хвостов, потом обрезка по слову. */
  function smartCropDisplayTitle(title, maxLen = 54) {
    let t = smartCleanTrackTitle(title)
    t = t.replace(TAIL_JUNK_RE, '').replace(/\s{2,}/g, ' ').trim()
    if (!t) return 'Без названия'
    if (t.length <= maxLen) return t
    const cut = t.slice(0, maxLen)
    const sp = cut.lastIndexOf(' ')
    if (sp > Math.floor(maxLen * 0.55)) return `${cut.slice(0, sp).trim()}…`
    return `${cut.trim()}…`
  }

  function splitArtistAndTitle(fileName) {
    const plain = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim()
    if (!plain) return { artist: 'Локальный файл', title: 'Без названия' }
    const chunks = plain.split(/\s+-\s+/)
    if (chunks.length >= 2) {
      return {
        artist: chunks.shift().trim() || 'Локальный файл',
        title: smartCleanTrackTitle(chunks.join(' - ')) || plain
      }
    }
    return { artist: 'Локальный файл', title: smartCleanTrackTitle(plain) || plain }
  }

  window.FlowModules = window.FlowModules || {}
  window.FlowModules.smartCleaning = {
    smartCleanTrackTitle,
    smartCropDisplayTitle,
    splitArtistAndTitle,
  }
})()
