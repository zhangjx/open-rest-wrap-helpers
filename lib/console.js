module.exports = (restapi) => {
  const logger = restapi.log;
  return {
    log(...args) {
      return (req, res, next) => {
        logger.log(...args);
        return next();
      };
    },

    info(...args) {
      return (req, res, next) => {
        logger.info(...args);
        return next();
      };
    },

    error(...args) {
      return (req, res, next) => {
        logger.error(...args);
        return next();
      };
    },

    warn(...args) {
      return (req, res, next) => {
        logger.warn(...args);
        return next();
      };
    },

    time(key) {
      return (req, res, next) => {
        console.time(key);
        return next();
      };
    },

    timeEnd(key) {
      return (req, res, next) => {
        console.timeEnd(key);
        return next();
      };
    },
  };
};
