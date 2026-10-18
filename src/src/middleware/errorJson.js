/*
 * error handling middleware for json requests
 */


export default (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Expires: '0',
  });
  res.status(err.status || 400).json({
    errors: [err.message],
  });
};
