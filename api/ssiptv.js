// Playlist raiz de navegação por gênero para o SS IPTV.
module.exports = function handler(req, res) {
  const routedReq = Object.create(req);
  routedReq.query = { ...(req.query || {}), mode: "ssiptv-index" };
  return require("./playlist")(routedReq, res);
};
