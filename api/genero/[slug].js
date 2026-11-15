// Playlist de filmes de um gênero para o SS IPTV.
module.exports = function handler(req, res) {
  const routedReq = Object.create(req);
  routedReq.query = { ...(req.query || {}), genre: req.query.slug || "" };
  return require("../playlist")(routedReq, res);
};
