// Atalho sem parâmetros para a playlist completa.
module.exports = function handler(req, res) {
  const routedReq = Object.create(req);
  routedReq.query = { ...(req.query || {}), type: "all" };
  return require("./playlist")(routedReq, res);
};
