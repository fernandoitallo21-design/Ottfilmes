// Atalho sem parâmetros para a playlist de séries.
module.exports = function handler(req, res) {
  const routedReq = Object.create(req);
  routedReq.query = { ...(req.query || {}), type: "series" };
  return require("./playlist")(routedReq, res);
};
