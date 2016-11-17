const _ = require('lodash');
const delegate = require('func-delegate');

const modelInclude = (params, includes) => {
  if (!includes) return;
  if (!_.isString(params.includes)) return;
  const ret = _.filter(params.includes.split(','), x => includes[x]);
  if (ret.length === 0) return;
  return _.map(ret, x => _.clone(includes[x]));
};

module.exports = (restapi) => {
  const Sequelize = restapi.Sequelize;

  const getter = (Model, hook, keyPath) => (req, res, next) => {
    const id = _.get(req, keyPath);
    const include = modelInclude(req.params, Model.includes);
    const opt = { where: { id } };
    if (include) opt.include = include;
    Model.find(opt).then(model => {
      req.hooks[hook] = model;
      next();
    }).catch(next);
  };

  const schema = [{
    name: 'Model',
    type: Sequelize.Model,
    message: 'Model must be a class of Sequelize defined',
  }, {
    name: 'hook',
    type: String,
    allowNull: false,
    message: 'Geted instance will hook on req.hooks[hook], so `hook` must be a string',
  }, {
    name: 'keyPath',
    type: String,
    allowNull: false,
    defaultValue: 'params.id',
    message: 'Gets the value at path of object.',
  }];

  return delegate(getter, schema);
};
