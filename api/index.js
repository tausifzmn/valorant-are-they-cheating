// Vercel serverless entry: re-export the Express app as the root handler.
// Vercel rewrites all traffic here (see vercel.json), and the original path
// is preserved, so Express routing works exactly as it does locally.
module.exports = require('../server.js');
