/*
 * formdata middlewares
 */
import express from 'express';

export default express.urlencoded({
  extended: true, limit: '200kB', parameterLimit: 20,
});
