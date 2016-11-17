const _ = require('lodash');
const delegate = require('func-delegate');
const utils = require('./utils');

module.exports = (restapi) => {
  const Sequelize = restapi.Sequelize;

  const schemas = {
    Model: {
      name: 'Model',
      type: Sequelize.Model,
      message: 'Model must be a class of Sequelize defined',
    },
    addHook: {
      name: 'hook',
      type: String,
      allowNull: false,
      message: 'Added instance will hook on req.hooks[hook], so `hook` must be a string',
    },
    detailHook: {
      name: 'hook',
      type: String,
      allowNull: false,
      message: 'Geted instance will hook on req.hooks[hook], so `hook` must be a string',
    },
    modifyHook: {
      name: 'hook',
      type: String,
      allowNull: false,
      message: 'Will modify instance hook on req.hooks[hook], so `hook` must be a string',
    },
    removeHook: {
      name: 'hook',
      type: String,
      allowNull: false,
      message: 'Remove instance hook on req.hooks[hook], so `hook` must be a string',
    },
    listHook: {
      name: 'hook',
      type: String,
      allowNull: true,
      message: 'Geted list will hook on req.hooks[hook], so `hook` must be a string',
    },
    cols: {
      name: 'cols',
      type: Array,
      allowNull: true,
      validate: {
        check(keys, schema, args) {
          const Model = args[0];
          _.each(keys, (v) => {
            if (!_.isString(v)) {
              throw Error('Every item in cols must be a string.');
            }
            if (!Model.rawAttributes[v]) {
              throw Error(`Attr non-exists: ${v}`);
            }
          });
          return true;
        },
      },
      message: "Allow writed attrs's name array",
    },
    attachs: {
      name: 'attachs',
      type: Object,
      allowNull: true,
      validate: {
        check(value) {
          _.each(value, (v) => {
            if (!_.isString(v)) {
              throw Error('The attachs structure is key = > value, value must be a string');
            }
          });
          return true;
        },
      },
      message: 'Attach other data dict. key => value, value is req\'s path',
    },
    statusCode: {
      name: 'statusCode',
      type: Number,
      allowNull: true,
      defaultValue: 200,
      message: 'HTTP statusCode, defaultValue is 200',
    },
    attrFilter: {
      name: 'attrFilter',
      type: Boolean,
      allowNull: true,
      defaultValue: true,
      message: 'Whether to allow filtering properties, defaultValue is true',
    },
    listOpt: {
      name: 'opt',
      type: String,
      allowNull: true,
      message: "FindAll option hooks's name, so `opt` must be a string",
    },
    allowAttrs: {
      name: 'allowAttrs',
      type: Array,
      allowNull: true,
      validate: {
        check(keys, schema, args) {
          const Model = args[0];
          _.each(keys, (v) => {
            if (!_.isString(v)) {
              throw Error('Every item in allowAttrs must be a string.');
            }
            if (!Model.rawAttributes[v]) {
              throw Error(`Attr non-exists: ${v}`);
            }
          });
          return true;
        },
      },
      message: "Allow return attrs's name array",
    },
  };

  /**
   * 修改某个资源描述的前置方法, 不会sync到数据库
   * Model 必选, Sequlize 定义的Model，表明数据的原型
   * cols 可选, 允许设置的字段
   * hook 必选, 生成实例的存放位置
   */
  const beforeAdd = (Model, cols, hook) => (req, res, next) => {
    const attr = utils.pickParams(req, cols || Model.writableCols, Model);

    // 存储数据
    const _save = (model) => {
      model.save().then((mod) => {
        req.hooks[hook] = mod;
        return next();
      }).catch(error => next(restapi.errors.sequelizeIfError(error, Model.name)));
    };

    // 约定的 creatorId, 等于 req.user.id
    if (Model.rawAttributes.creatorId) attr.creatorId = req.user.id;
    // 约定的 clientIp, 等于utils.clientIp(req)
    if (Model.rawAttributes.clientIp) attr.clientIp = utils.clientIp(req);

    // 如果没有设置唯一属性，或者没有开启回收站
    if ((!Model.unique) || (!Model.rawAttributes.isDelete)) {
      return _save(Model.build(attr));
    }

    // 如果设置了唯一属性，且开启了回收站功能
    // 则判断是否需要执行恢复操作
    const where = {};
    _.each(Model.unique, (x) => {
      where[x] = attr[x];
    });

    // 根据条件查找资源
    Model.findOne({ where }).then((model) => {
      // 资源存在
      if (model) {
        // 且资源曾经被删除
        if (model.isDelete === 'yes') {
          _.extend(model, attr);
          // 恢复为正常状态
          model.isDelete = 'no';
        } else {
          // 资源已经存在，重复了
          return next(restapi.errors.AlreadyExists(Model.name, Model.unique[0]));
        }
      } else {
        // 构建一个全新的资源
        model = Model.build(attr);
      }
      // 保存资源
      _save(model);
    }).catch(next);
  };

  // 获取单个资源详情的方法
  // hook 必选，要输出的数据在 req.hooks 的什么位置
  // attachs 可选，要附加输出的数据格式为 key => value, value 是 req 上的路径字符串
  // statusCode 可选，输出使用的http状态码
  // attrFilter 可选, 是否允许过滤属性, 默认允许
  const detail = (hook, attachs, statusCode, attrFilter) => (req, res, next) => {
    // 获取数据
    const model = req.hooks[hook];

    let attrs;
    let ret = model.toJSON ? model.toJSON() : model;

    // 附加额外的数据
    if (attachs) {
      _.each(attachs, (v, k) => {
        ret[k] = _.get(req, v);
      });
    }

    // 过滤属性值
    if ((attrFilter === true) && _.isString(req.params.attrs)) {
      attrs = req.params.attrs.split(',');
      if (_.isArray(ret)) {
        ret = utils.listAttrFilter(ret, attrs);
      } else {
        ret = utils.itemAttrFilter(attrs)(ret);
      }
    }

    // 输出
    res.send(statusCode, ret);
    return next();
  };

  /**
   * 根据资源描述添加资源到集合上的方法
   * Model 必选, Sequlize 定义的Model，表明数据的原型
   * cols 可选, 允许修改的字段
   * hook 必选, 实例的存放位置
   * attachs 可选，要附加输出的数据格式为 key => value, value 是 req 上的路径字符串
   */
  const add = (Model, cols, hook, attachs) => {
    // 这里hook其实是必须的，因为这里把 add 分成两个部分，
    // 为了避免冲突导致，这里引入了随机字符串
    if (!hook) hook = `${Model.name}_${restapi.utils.randStr(10)}`;

    const before = beforeAdd(Model, cols, hook);
    const after = detail(hook, attachs, 201);

    return (req, res, next) => {
      before(req, res, (error) => {
        if (error) return next(error);
        return after(req, res, next);
      });
    };
  };

  /**
   * 修改某个资源描述的后置方法, 将变化保存到数据库
   * hook 必选, 实例的存放位置
   */
  const save = (Model, hook) => (req, res, next) => {
    const model = req.hooks[hook];
    const changed = model.changed();
    // 如果没有变化，则不需要保存，也不需要记录日志
    if (!changed) {
      req._resourceNotChanged = true;
      res.header('X-Content-Resource-Status', 'Unchanged');
      res.send(model);
      return next();
    }
    model.save({ fields: changed }).then((mod) => {
      res.send(mod);
      return next();
    }).catch(error => next(restapi.errors.sequelizeIfError(error, Model.name)));
  };

  /**
   * 修改某个资源描述的前置方法, 不会sync到数据库
   * Model 必选, Sequlize 定义的Model，表明数据的原型
   * hook 必选, 实例的存放位置
   * cols 可选, 允许修改的字段
   */
  const beforeModify = (Model, hook, cols) => (req, res, next) => {
    const model = req.hooks[hook];
    let attr;
    cols = cols || Model.editableCols || Model.writableCols;
    try {
      attr = utils.pickParams(req, cols, Model);
    } catch (e) {
      return next(e);
    }
    delete attr.id;
    _.each(attr, (v, k) => {
      if (model[k] === v) return;
      model[k] = v;
    });
    return next();
  };

  /**
   * 修改某个资源描述的方法
   * Model 必选, Sequlize 定义的Model，表明数据的原型
   * hook 必选, 实例的存放位置
   * cols 可选, 允许修改的字段
   */
  const modify = (Model, hook, cols) => {
    const before = beforeModify(Model, hook, cols);
    const after = save(Model, hook);

    return (req, res, next) => {
      before(req, res, (error) => {
        if (error) return next(error);
        return after(req, res, next);
      });
    };
  };

  // 删除单个资源的方法
  // hook 必选，要删除的实例在 req.hooks 的什么位置
  const remove = hook => (req, res, next) => {
    const model = req.hooks[hook];
    ((() => {
      // 资源如果有isDelete 字段则修改isDelete 为yes即可
      if (!model.isDelete) return model.destroy();
      model.isDelete = 'yes';
      return model.save();
    }))().then(() => {
      res.send(204);
      return next();
    }).catch(next);
  };

  /**
   * 获取资源列表的通用方法
   * Model Sequlize 定义的Model，表明数据从哪里获取
   * _options 是否要去req.hooks上去options
   * allowAttrs 那些字段是被允许的
   * hook 默认为空，如果指定了hook，则数据不直接输出而是先挂在 hook上
   */
  const list = (Model, opt, allowAttrs, hook) => {
    // 统计符合条件的条目数
    const getTotal = (opts, ignoreTotal, callback) => {
      if (ignoreTotal) return callback();
      utils.callback(Model.count(opts), callback);
    };

    return (req, res, next) => {
      const options = opt ? req.hooks[opt] : utils.findAllOpts(Model, req.params);
      const countOpt = {};
      if (options.where) countOpt.where = options.where;
      if (options.include) countOpt.include = options.include;
      // 是否忽略总条目数，这样就可以不需要count了。在某些时候可以
      // 提高查询速度
      const ignoreTotal = req.params._ignoreTotal === 'yes';
      let ls = [];
      getTotal(countOpt, ignoreTotal, (error, count) => {
        if (error) return next(error);
        if (ignoreTotal || count) {
          Model.findAll(options).then((result) => {
            ls = utils.listAttrFilter(result, allowAttrs);
            if (!ignoreTotal) res.header('X-Content-Record-Total', count);
            if (!hook && req.params.attrs) {
              ls = utils.listAttrFilter(ls, req.params.attrs.split(','));
            }
            if (hook) {
              req.hooks[hook] = ls;
            } else {
              res.send(ls);
            }
            next();
          }).catch(next);
        } else {
          res.header('X-Content-Record-Total', 0);
          if (hook) {
            req.hooks[hook] = ls;
          } else {
            res.send(ls);
          }
          return next();
        }
      });
    };
  };

  const beforeAddschema = [schemas.Model, schemas.cols, schemas.addHook];
  const addSchema = [schemas.Model, schemas.cols, schemas.addHook, schemas.attachs];
  const detailSchema = [schemas.detailHook, schemas.attachs, schemas.statusCode, schemas.attrFilter];
  const beforeModifySchema = [schemas.modifyHook, schemas.cols];
  const saveSchema = [schemas.modifyHook];
  const modifySchema = [schemas.Model, schemas.modifyHook, schemas.cols];
  const removeSchema = [schemas.removeHook];
  const listSchema = [schemas.Model, schemas.listOpt, schemas.allowAttrs, schemas.listHook];

  return {
    beforeAdd: delegate(beforeAdd, beforeAddschema),
    add: delegate(add, addSchema),
    detail: delegate(detail, detailSchema),
    beforeModify: delegate(beforeModify, beforeModifySchema),
    save: delegate(save, saveSchema),
    modify: delegate(modify, modifySchema),
    remove: delegate(remove, removeSchema),
    list: delegate(list, listSchema),
  };
};
