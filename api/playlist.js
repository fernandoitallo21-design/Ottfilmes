const DEFAULT_BASE = "https://filmes-saimo.pages.dev/";
const BASE_CANDIDATES = process.env.SAIMO_VOD_BASE ? [process.env.SAIMO_VOD_BASE] : [DEFAULT_BASE, DEFAULT_BASE + "vod/"];
const MAX_ITEMS = 20000;
let ACTIVE_BASE = null;

async function readText(path) {
  const candidates = ACTIVE_BASE ? [ACTIVE_BASE] : BASE_CANDIDATES;
  let lastError;
  for (const candidate of candidates) {
    const base = candidate.endsWith("/") ? candidate : candidate + "/";
    try {
      const response = await fetch(new URL(path, base), { headers: { "accept": "text/plain,*/*" } });
      if (!response.ok) {
        lastError = new Error("Falha ao ler " + path + " (HTTP " + response.status + ") em " + base);
        continue;
      }
      ACTIVE_BASE = base;
      return await response.text();
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Não foi possível localizar " + path);
}

function safeUrl(value, bases) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url = raw;
  const match = raw.match(/^(\d+):(.*)$/);
  if (match) {
    const root = bases.get(Number(match[1]));
    if (!root) return null;
    let tail = match[2].trim();
    if (!tail.includes(".")) tail += ".mp4";
    try { url = new URL(tail.replace(/^\/+/, ""), root).href; } catch { return null; }
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (!/\.(m3u8|mp4|mpd|ts|mkv|avi|mov|webm)(\?|#|$)/i.test(parsed.href)) return null;
    // DASH sources with ClearKey are intentionally omitted; this endpoint does not handle DRM.
    if (/\.mpd(\?|#|$)/i.test(parsed.href)) return null;
    return parsed.href;
  } catch { return null; }
}

function parseVersions(fields, bases) {
  const result = [];
  for (const field of fields) {
    const at = field.indexOf("=");
    if (at < 1) continue;
    const version = field.slice(0, at).trim().toLowerCase();
    const sources = field.slice(at + 1).split(",");
    for (let i = 0; i < sources.length; i++) {
      const url = safeUrl(sources[i], bases);
      if (url) result.push({ version, url });
    }
  }
  return result;
}

function cleanDisplayTitle(value) {
  return String(value || "")
    .replace(/\\[[^\\]]*(?:1080p|720p|2160p|4k|web[- .]?dl|bluray|brrip|hdtv|x264|x265)[^\\]]*\\]/ig, "")
    .replace(/\\((?:1080p|720p|2160p|4k|web[- .]?dl|bluray|brrip|hdtv|x264|x265)[^)]*\\)/ig, "")
    .replace(/[_.]+/g, " ").replace(/\\s{2,}/g, " ").trim();
}

function normTitle(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function makeImageUrl(value, imageBase) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try { return new URL(raw, imageBase || ACTIVE_BASE || DEFAULT_BASE).href; }
  catch { return ""; }
}

async function loadCovers() {
  const covers = new Map();
  let imageBase = "";
  try {
    const fichas = await readText("fichas.txt");
    for (const line of fichas.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (/^\s*capa:\s*/i.test(line)) {
        imageBase = line.replace(/^\s*capa:\s*/i, "").trim();
        continue;
      }
      if (!line.trim() || line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length < 4) continue;
      const kind = c[0].trim().toLowerCase();
      const title = c[1].trim();
      const logo = makeImageUrl(c[3], imageBase);
      if (logo && title) covers.set((kind === "s" ? "s:" : "f:") + normTitle(title), logo);
    }
  } catch (_) {}

  // Fallback: destaques.txt também contém capas e o prefixo das imagens.
  try {
    const highlights = await readText("destaques.txt");
    for (const line of highlights.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (/^\s*capa:\s*/i.test(line)) {
        imageBase = line.replace(/^\s*capa:\s*/i, "").trim();
        continue;
      }
      if (!line.trim() || line.startsWith("#") || line.startsWith("fila\t")) continue;
      const c = line.split("\t");
      if (c.length < 5) continue;
      const kind = c[0].trim().toLowerCase();
      const title = c[1].trim();
      const logo = makeImageUrl(c[4], imageBase);
      const key = (kind === "s" ? "s:" : "f:") + normTitle(title);
      if (logo && title && !covers.has(key)) covers.set(key, logo);
    }
  } catch (_) {}
  return covers;
}

async function loadMetadata() {
  const metadata = new Map();
  const keyFor = (kind, title) => (kind === "s" ? "s:" : "f:") + normTitle(title);
  try {
    const fichas = await readText("fichas.txt");
    for (const line of fichas.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#") || /^\s*capa:/i.test(line)) continue;
      const c = line.split("\t");
      if (c.length < 5) continue;
      const kind = c[0].trim().toLowerCase(), title = c[1].trim(), key = keyFor(kind, title);
      const old = metadata.get(key) || {};
      metadata.set(key, { ...old, tmdbId: c[2].trim(), genres: c[4].trim() });
    }
  } catch (_) {}
  try {
    const details = await readText("detalhes.txt");
    for (const line of details.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const c = line.split("\t");
      if (c.length < 5) continue;
      const kind = c[0].trim().toLowerCase(), title = c[1].trim(), key = keyFor(kind, title);
      const old = metadata.get(key) || {};
      metadata.set(key, { ...old, year: c[2].trim(), rating: c[3].trim(), certification: c[4].trim(), popularity: c[5] ? c[5].trim() : "" });
    }
  } catch (_) {}
  return metadata;
}

const GENRES = [
  ["acao", "Ação"], ["aventura", "Aventura"], ["animacao", "Animação"],
  ["comedia", "Comédia"], ["crime", "Crime"], ["documentario", "Documentário"],
  ["drama", "Drama"], ["familia", "Família"], ["fantasia", "Fantasia"],
  ["ficcao-cientifica", "Ficção científica"], ["historia", "História"],
  ["terror", "Terror"], ["musica", "Música"], ["misterio", "Mistério"],
  ["romance", "Romance"], ["suspense", "Suspense / Thriller"],
  ["guerra", "Guerra"], ["faroeste", "Faroeste"]
];

function normalizeGenre(value) {
  return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function genreMatches(value, slug) {
  const raw = String(value || "");
  const parts = raw.split(/[|,;/]+/).map(normalizeGenre).filter(Boolean);
  const aliases = {
    "ficcao-cientifica": ["ficcao cientifica", "science fiction", "sci fi", "sci-fi"],
    "suspense": ["suspense", "thriller"],
    "acao": ["acao", "action"],
    "aventura": ["aventura", "adventure"],
    "animacao": ["animacao", "animation"],
    "comedia": ["comedia", "comedy"],
    "crime": ["crime"],
    "documentario": ["documentario", "documentary"],
    "drama": ["drama"],
    "familia": ["familia", "family"],
    "fantasia": ["fantasia", "fantasy"],
    "historia": ["historia", "history"],
    "terror": ["terror", "horror"],
    "musica": ["musica", "music"],
    "misterio": ["misterio", "mystery"],
    "romance": ["romance"],
    "guerra": ["guerra", "war"],
    "faroeste": ["faroeste", "western"]
  };
  const wanted = aliases[slug] || [normalizeGenre(slug)];
  return parts.some(part => wanted.includes(part));
}

function cleanAttribute(value) {
  return String(value || "").replace(/[\r\n"]/g, " ").replace(/\s+/g, " ").trim();
}

function entry(title, url, group, label, logo, meta = {}) {
  const cleanTitle = cleanDisplayTitle(title).replace(/[\\r\\n]/g, " ").replace(/"/g, "'").trim();
  const year = cleanAttribute(meta.year), rating = cleanAttribute(meta.rating);
  const genres = cleanAttribute(meta.genres), certification = cleanAttribute(meta.certification);
  const displayBase = year && !cleanTitle.endsWith("(" + year + ")") ? cleanTitle + " (" + year + ")" : cleanTitle;
  const score = rating && Number.isFinite(Number(rating)) ? " ★ " + Number(rating).toFixed(1) + "/10" : "";
  const display = displayBase + score + (label ? " [" + label + "]" : "");
  const cleanGroup = String(group).replace(/[\r\n"]/g, " ").trim();
  const attrs = [];
  if (logo) attrs.push('tvg-logo="' + String(logo).replace(/"/g, "%22") + '"');
  if (meta.tmdbId) attrs.push('tmdb-id="' + cleanAttribute(meta.tmdbId) + '"');
  if (year) attrs.push('tvg-year="' + year + '"');
  if (rating) attrs.push('tvg-rating="' + rating + '"');
  if (genres) attrs.push('tvg-genre="' + genres + '"');
  if (certification) attrs.push('tvg-rating-system="' + certification + '"');
  return '#EXTINF:-1 ' + attrs.join(" ") + ' group-title="' + cleanGroup + '",' + display + "\n" + url;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const mode = String(req.query.mode || "").toLowerCase();
    if (mode === "ssiptv-index") {
      const baseUrl = "https://ottfilmes.vercel.app";
      const lines = ["#EXTM3U"];
      for (const [slug, label] of GENRES) {
        lines.push('#EXTINF:0 type="playlist",' + label);
        lines.push(baseUrl + "/api/genero/" + slug);
      }
      return res.status(200).send(lines.join("\\n") + "\\n");
    }
    const genreFilter = String(req.query.genre || "").toLowerCase();
    const type = genreFilter ? "movies" : String(req.query.type || "all").toLowerCase();
    if (!["all", "movies", "series"].includes(type)) return res.status(400).send("Use type=all, movies ou series");
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 20000)) : (genreFilter ? 20000 : 500);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;

    const index = await readText("indice.txt");
    const bases = new Map();
    const letters = [];
    for (const line of index.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const base = line.match(/^\s*base:\s*(\d+)\s+(https?:\/\/\S+)/i);
      if (base) { bases.set(Number(base[1]), base[2].endsWith("/") ? base[2] : base[2] + "/"); continue; }
      const cols = line.split("\t");
      if (cols.length >= 3 && (/^[A-Z]$/.test(cols[0]) || cols[0] === "#")) {
        if (Number(cols[1]) > 0 || Number(cols[2]) > 0) letters.push(cols[0]);
      }
    }

    const covers = await loadCovers();
    const metadata = await loadMetadata();
    const output = ["#EXTM3U"];
    const seen = new Set();
    const jobs = [];
    for (const letter of letters) {
      const fileLetter = letter === "#" ? "%23" : letter;
      if (type !== "series") jobs.push((async () => {
        try {
          const content = await readText("filmes-" + fileLetter + ".txt");
          for (const line of content.split(/\r?\n/)) {
            if (!line.trim() || line.startsWith("#")) continue;
            const cols = line.split("\t");
            if (cols.length < 2) continue;
            const title = cols[0].trim();
            for (const v of parseVersions(cols.slice(1), bases)) {
              const versionLabel = v.version === "dub" ? "Dublado" : v.version === "leg" ? "Legendado" : v.version;
              const logo = covers.get("f:" + normTitle(title)) || "";
              const meta = metadata.get("f:" + normTitle(title)) || {};\n              if (genreFilter && !genreMatches(meta.genres, genreFilter)) continue;
              const key = ["f", normTitle(title), versionLabel].join("|");
              if (!seen.has(key)) { seen.add(key); output.push(entry(title, v.url, "Filmes", versionLabel, logo, meta)); }
              if (output.length >= MAX_ITEMS * 2) return;
            }
          }
        } catch (e) { if (!/HTTP 404/.test(e.message)) throw e; }
      })());

      if (type !== "movies") jobs.push((async () => {
        let seriesText;
        try { seriesText = await readText("series-" + fileLetter + ".txt"); }
        catch (e) { if (/HTTP 404/.test(e.message)) return; throw e; }
        const series = [];
        for (const line of seriesText.split(/\r?\n/)) {
          if (!line.trim() || line.startsWith("#")) continue;
          const c = line.split("\t");
          if (c.length >= 4) series.push({ title: c[0].trim(), year: c[1].trim(), shard: c[2].trim() });
        }
        const shards = [...new Set(series.map(s => s.shard))];
        const shardContents = await Promise.all(shards.map(async shard => {
          try { return [shard, await readText("series-" + fileLetter + "-" + shard + ".txt")]; }
          catch (e) { if (/HTTP 404/.test(e.message)) return [shard, ""]; throw e; }
        }));
        const byShard = new Map(shardContents);
        for (const s of series) {
          const content = byShard.get(s.shard) || "";
          let active = false;
          const show = s.title + (s.year ? " (" + s.year + ")" : "");
          for (const line of content.split(/\r?\n/)) {
            if (line.startsWith("@")) {
              const h = line.slice(1).split("\t");
              active = h[0] === s.title && (h[1] || "") === s.year;
              continue;
            }
            if (!active || !line.trim() || line.startsWith("#")) continue;
            const c = line.split("\t");
            if (c.length < 4) continue;
            const season = c[0].trim(), episode = c[1].trim(), version = c[2].trim().toLowerCase();
            for (const src of (c[3] || "").split(",")) {
              const url = safeUrl(src, bases);
              if (!url) continue;
              const label = "T" + season.padStart(2, "0") + "E" + episode.padStart(2, "0") + (version === "dub" ? " Dublado" : version === "leg" ? " Legendado" : "");
              const logo = covers.get("s:" + normTitle(s.title)) || "";
              const meta = metadata.get("s:" + normTitle(s.title)) || {};
              const key = ["s", normTitle(show), label].join("|");
              if (!seen.has(key)) { seen.add(key); output.push(entry(show + " - " + label, url, "Séries", "", logo, meta)); }
              if (output.length >= MAX_ITEMS * 2) return;
            }
          }
        }
      })());
    }
    await Promise.all(jobs);
    if (output.length === 1) return res.status(200).send("#EXTM3U\n");
    const sortedEntries = output.slice(1).sort((a, b) => {
      const titleA = a.slice(0, a.indexOf("\\n")).split(",").slice(-1)[0] || "";
      const titleB = b.slice(0, b.indexOf("\\n")).split(",").slice(-1)[0] || "";
      return titleA.localeCompare(titleB, "pt-BR", { numeric: true, sensitivity: "base" });
    });
    const entries = sortedEntries.slice(offset, offset + limit);
    res.setHeader("X-Playlist-Total", String(output.length - 1));
    res.setHeader("X-Playlist-Returned", String(entries.length));
    res.setHeader("X-Playlist-Offset", String(offset));
    return res.status(200).send(["#EXTM3U", ...entries].join("\n") + "\n");
  } catch (error) {
    console.error(error);
    return res.status(502).send("# Erro ao consultar o catálogo Saimo: " + String(error.message || error).replace(/[\r\n]/g, " ") + "\n");
  }
};
