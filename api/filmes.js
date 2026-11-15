// Atalho sem parâmetros para a playlist de filmes.
module.exports = function handler(req, res) {
  const routedReq = Object.create(req);
  routedReq.query = { ...(req.query || {}), type: "movies" };
  return require("./playlist")(routedReq, res);
};
