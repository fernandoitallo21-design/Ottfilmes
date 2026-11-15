const BASE = (process.env.SAIMO_VOD_BASE || "https://filmes-saimo.pages.dev/vod/").replace(/\/?$/, "/");
const MAX_ITEMS = 20000;

async function readText(path) {
  const url = new URL(path, BASE);
  const response = await fetch(url, { headers: { "accept": "text/plain,*/*" } });
  if (!response.ok) throw new Error("Falha ao ler " + path + " (HTTP " + response.status + ")");
  return response.text();
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

function entry(title, url, group, label) {
  const cleanTitle = String(title).replace(/[\r\n]/g, " ").replace(/"/g, "'").trim();
  const display = label ? cleanTitle + " [" + label + "]" : cleanTitle;
  const cleanGroup = String(group).replace(/[\r\n"]/g, " ").trim();
  return '#EXTINF:-1 group-title="' + cleanGroup + '",' + display + "\n" + url;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const type = String(req.query.type || "all").toLowerCase();
    if (!["all", "movies", "series"].includes(type)) return res.status(400).send("Use type=all, movies ou series");

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

    const output = ["#EXTM3U"];
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
              output.push(entry(title, v.url, "Filmes", v.version === "dub" ? "Dublado" : v.version === "leg" ? "Legendado" : v.version));
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
              output.push(entry(show + " - " + label, url, "Séries", ""));
              if (output.length >= MAX_ITEMS * 2) return;
            }
          }
        }
      })());
    }
    await Promise.all(jobs);
    if (output.length === 1) return res.status(200).send("#EXTM3U\n");
    return res.status(200).send(output.join("\n") + "\n");
  } catch (error) {
    console.error(error);
    return res.status(502).send("# Erro ao consultar o catálogo Saimo: " + String(error.message || error).replace(/[\r\n]/g, " ") + "\n");
  }
};
