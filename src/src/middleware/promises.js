/*
 * express middleware that resolve promises under req.promise array.
 * This is handy if we have to fetch multiple things simultaniously, e.g.
 * resolving a session and doing a proxycheck.
 */
export default async (req, res, next) => {
  if (req.promise) {
    await Promise.all(req.promise);
    delete req.promise;
  }
  next();
};
