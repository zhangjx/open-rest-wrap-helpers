const _ = require('lodash');
const mysql = require('mysql');

const NUMBER_TYPES = ['INTEGER', 'FLOAT'];
/** 随机字符串字典 */
const RAND_STR_DICT = {
  normal: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  strong: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~!@#$%^&*()_+<>{}|\=-`~',
};

/**
 * 生成随机字符串
 * @param  {Integer}  len   生成的随机串的长度
 * @param  {String=[normal','strong']} type   随机串的强度, defaultValue is normal
 * @return {String}                           随机字符串
 */
const randStr = (len, type) => {
  const dict = RAND_STR_DICT[type || 'normal'] || type;
  const length = dict.length;

  /** 随机字符串的长度不能等于 0 或者负数*/
  len = parseInt(len, 10) || 0;
  if (len < 1) len = 3;

  return _.map(_.times(len), () => dict[Math.floor(Math.random() * length)]).join('');
};

/**
 * 把 callback 的写法，作用到 promise 上
 * promise.then(->callback(null)).catch(callback)
 * @param  {Object}   promise   promisefy instance
 * @param  {Function} callback  callback Function
 * @return {Function}          [description]
 */
const callback = (promise, cb) => promise.then(result => cb.call(null, null, result)).catch(cb);

/**
 * Pick params
 * @param  {Object} req   request Object
 * @param  {Array} cols   picked columns
 * @param  {Object} Model Model object
 * @return {Object} attr  picked data
 */
const pickParams = (req, cols, Model) => {
  const attr = {};

  // 当设置了只有管理员才可以修改的字段，并且当前用户不是管理员
  // 则去掉那些只有管理员才能修改的字段
  if (Model.onlyAdminCols && (req.isAdmin !== true)) {
    cols = _.filter(cols, x => !_.includes(Model.onlyAdminCols, x));
  }

  _.each(cols, (x) => {
    let value;
    let C;
    if (!req.params.hasOwnProperty(x)) return;
    if (!(C = Model.rawAttributes[x])) return;

    value = req.params[x];
    // 如果是数字类型的则数字化
    if (_.includes(NUMBER_TYPES, C.type.key)) {
      if (value != null) value = +value;
    }

    // 如果字段允许为空，且默认值为 null 则在等于空字符串的时候赋值为 null
    if ((value === '' || value === null || value === undefined) && C.hasOwnProperty('defaultValue')) {
      value = (C.allowNull === true) ? null : C.defaultValue;
    }
    attr[x] = value;
  });
  return attr;
};

/**
 * 处理排序参数
 * @param  {Object} params   request params
 * @param  {Object} conf     default sort config
 * @return {Array}           [['id', 'desc']]
 */
const sort = (params, conf) => {
  if (!conf) return;
  if (!(params.sort || conf.default)) return;
  let order = conf.default;
  let direction = conf.defaultDirection || 'ASC';

  if (!params.sort) return [[order, direction]];

  if (params.sort[0] === '-') {
    direction = 'DESC';
    order = params.sort.substring(1);
  } else {
    direction = 'ASC';
    order = params.sort;
  }

  // 如果请求的排序方式不允许，则返回null
  if (!conf.allow || !_.includes(conf.allow, order)) return;

  return [[order, direction]];
};

/**
 * 处理分页参数
 * @param  {Object} pagination 默认分页配置
 * @param  {Object} params     request params
 * @return {Object}            {limit: xxx, offset: xxx}
 */
const pageParams = (pagination, params) => {
  if (pagination == null) {
    pagination = {
      maxResults: 10,
      maxStartIndex: 10000,
      maxResultsLimit: 1000,
    };
  }
  const startIndex = Math.max((+params.startIndex || 0), 0);
  const maxResults = Math.max((+params.maxResults || +pagination.maxResults), 0);
  return {
    offset: Math.min(startIndex, pagination.maxStartIndex),
    limit: Math.min(maxResults, pagination.maxResultsLimit),
  };
};

/**
 * 处理关联包含
 * @param  {Object} params   request params
 * @param  {String} includes ',' 连接的值
 * @return {Array}           [Model1, Model2] or undefined
 */
const modelInclude = (params, includes) => {
  if (!includes) return;
  if (!_.isString(params.includes)) return;
  const ret = _.filter(params.includes.split(','), x => includes[x]);
  if (ret.length === 0) return;
  return _.map(ret, x => _.clone(includes[x]));
};

/**
 * 处理 params 里的过滤条件，转化为SQL 的查询条件
 * @param  {Object} params   request params
 * @param  {String} name     filter condition keyName
 * @param  {Object} where    where condition Object
 * @param  {String} [col]    data actual attr name
 * @return {Null}
 */
const findOptFilter = (params, name, where, col) => {
  let value;
  if (col == null) col = name;
  if (!params) return;
  if (!_.isObject(params)) return;
  // 处理 where 的等于
  if (_.isString(params[name])) {
    value = params[name].trim();
    // 特殊处理null值
    if (value === '.null.') value = null;
    if (!where[col]) where[col] = {};
    where[col].$eq = value;
  }
  if (_.isNumber(params[name])) {
    if (!where[col]) where[col] = {};
    where[col].$eq = params[name];
  }

  // 处理where in
  if (_.isString(params[`${name}s`])) {
    if (!where[col]) where[col] = {};
    where[col].$in = params[`${name}s`].trim().split(',');
  }

  // 处理where not in
  if (_.isString(params[`${name}s!`])) {
    if (!where[col]) where[col] = {};
    where[col].$not = params[`${name}s!`].trim().split(',');
  }

  // 处理不等于的判断
  if (_.isString(params[`${name}!`])) {
    value = params[`${name}!`].trim();
    // 特殊处理null值
    if (value === '.null.') value = null;
    if (!where[col]) where[col] = {};
    where[col].$ne = value;
  }

  // 处理like
  if (_.isString(params[`${name}_like`])) {
    value = params[`${name}_like`].trim().replace(/\*/g, '%');
    if (!where[col]) where[col] = {};
    where[col].$like = value;
  }

  // 处理notLike
  if (_.isString(params[`${name}_notLike`])) {
    value = params[`${name}_notLike`].trim().replace(/\*/g, '%');
    if (!where[col]) where[col] = {};
    where[col].$notLike = value;
  }
  // 处理大于，小于, 大于等于，小于等于的判断
  _.each(['gt', 'gte', 'lt', 'lte'], (x) => {
    const c = `${name}_${x}`;
    if (!_.isString(params[c]) && !_.isNumber(params[c])) return;
    value = _.isString(params[c]) ? params[c].trim() : params[c];
    if (!where[col]) where[col] = {};
    where[col][`$${x}`] = value;
  });
};

/**
 * searchOpt 的处理，处理参数参数里的q, 实现简易搜索功能
 *
 * [ # 这下面有三个子数组，代表该model有三个字段参与搜索
   [ # 这个数组长度为2，代表此次有2个搜索关键词
     # 这个字符串用 OR 切开有三部分，代表该字段定义的search.match 有三部分
     '((`user`.`name` LIKE \'a\') OR (`user`.`name` LIKE \'%,a\') OR (`user`.`name` LIKE \'a,%\') OR (`user`.`name` LIKE \'%,a,%\'))'
     '((`user`.`name` LIKE \'b\') OR (`user`.`name` LIKE \'%,b\') OR (`user`.`name` LIKE \'b,%\') OR (`user`.`name` LIKE \'%,b,%\'))'
   ]
   [
     '((`user`.`email` LIKE \'%a%\'))'
     '((`user`.`email` LIKE \'%b%\'))'
   ]
   [
     '((`user`.`id` = \'a\'))'
     '((`user`.`id` = \'b\'))'
   ]
 ]
 */
const searchOpt = (Model, searchStr, qstr, as) => {
  if (!qstr) return;
  if (!_.isString(qstr)) return;
  const q = qstr.trim() ? _.split(qstr.trim(), ' ', 5) : null;
  const searchs = searchStr ? _.split(searchStr, ',') : null;
  const $ors = [];
  if (!q) return;
  if (!Model.searchCols) return;
  _.each(Model.searchCols, (conf, col) => {
    // 如果设置了搜索的字段，并且当前字读不在设置的搜索字段内，则直接返回
    // 相当于跳过这个设置
    const _col = as ? `${as}.${col}` : col;
    // 如果是include里的search，必须指定searchs
    // 这么做是为了避免用户不知情的一些筛选过滤
    if ((!searchs) && as) return;
    if (searchs && searchs.length && !_.includes(searchs, _col)) return;
    $ors.push(_.map(q, (x) => {
      const m = _.map(conf.match, (match) => {
        const v = match.replace('{1}', x);
        return [
          '(`' + (as || Model.name) + '`.`' + col + '`',
          conf.op,
          `${mysql.escape(v)})`,
        ].join(' ');
      });
      return `(${m.join(' OR ')})`;
    }));
  });
  return $ors;
};

/**
 * 合并多个词语的搜索条件
 * 将单个或多个 searchOpt 返回的数组正确的合并成 where 子句, 字符串类型的
 * 这个函数的目的是为了正确的使每个关键词之间的关系是 AND 的关系
 * 单个关键词在不同的搜索字段之间是 OR 的关系
 * @param  {Array} orss   Search conditions
 * @return {String}       SQL snippet
 */
const mergeSearchOrs = (orss) => {
  const ands = [];
  _.each(orss, (_orss) => {
    _.each(_orss, (ors) => {
      _.each(ors, (_or, index) => {
        if (!ands[index]) ands[index] = [];
        ands[index].push(_or);
      });
    });
  });
  return `(${_.map(ands, x => '(' + x.join(' OR ') + ')').join(' AND ')})`;
};

// 返回列表查询的条件
const findAllOpts = (Model, params, isAll) => {
  const where = {};
  let searchOrs = [];

  const includes = modelInclude(params, Model.includes);
  _.each(Model.filterAttrs || _.keys(Model.rawAttributes), (name) => {
    findOptFilter(params, name, where);
  });
  if (Model.rawAttributes.isDelete && !params.showDelete) {
    where.isDelete = 'no';
  }

  // 将搜索条件添加到主条件上
  searchOrs.push(searchOpt(Model, params._searchs, params.q));

  // 处理关联资源的过滤条件
  // 以及关联资源允许返回的字段
  if (includes) {
    _.each(includes, (x) => {
      const includeWhere = {};
      const filterAttrs = x.model.filterAttrs || _.keys(x.model.rawAttributes);
      _.each(filterAttrs, (name) => {
        findOptFilter(params[x.as], name, includeWhere, name);
      });
      if (x.model.rawAttributes.isDelete && !params.showDelete) {
        includeWhere.$or = [{ isDelete: 'no' }];
        if (x.required === false) includeWhere.$or.push({ id: null });
      }

      // 将搜索条件添加到 include 的 where 条件上
      searchOrs.push(searchOpt(x.model, params._searchs, params.q, x.as));

      if (_.size(includeWhere)) x.where = includeWhere;

      // 以及关联资源允许返回的字段
      if (x.model.allowIncludeCols) x.attributes = x.model.allowIncludeCols;
    });
  }

  // 将 searchOrs 赋到 where 上
  searchOrs = _.filter(_.compact(searchOrs), x => x.length);
  if (searchOrs.length) where.$or = [[mergeSearchOrs(searchOrs), ['']]];

  const ret = {
    include: includes,
    order: sort(params, Model.sort),
  };

  if (_.size(where)) ret.where = where;

  // 处理需要返回的字段
  ((() => {
    if (!params.attrs) return;
    if (!_.isString(params.attrs)) return;
    const attrs = [];
    _.each(params.attrs.split(','), (x) => {
      if (!Model.rawAttributes[x]) return;
      attrs.push(x);
    });
    if (!attrs.length) return;
    ret.attributes = attrs;
  }))();

  if (!isAll) _.extend(ret, pageParams(Model.pagination, params));

  return ret;
};

/**
 * Filter item data by allowAttrs
 * @param  {Array} allowAttrs   Allow show attrs
 * @return {Function}           filter Function
 */
const itemAttrFilter = allowAttrs => (x) => {
  const ret = {};
  _.each(allowAttrs, attr => ret[attr] = x[attr]);
  return ret;
};

/**
 * Filter list data by allowed attrs
 * @param  {Array} ls           list data
 * @param  {Array} allowAttrs   Allow show attrs
 * @return {Array}              filtered list data
 */
const listAttrFilter = (ls, allowAttrs) => {
  if (!allowAttrs) return ls;
  return _.map(ls, itemAttrFilter(allowAttrs));
};

module.exports = {
  randStr,
  callback,
  pickParams,
  sort,
  pageParams,
  modelInclude,
  findOptFilter,
  searchOpt,
  mergeSearchOrs,
  findAllOpts,
  itemAttrFilter,
  listAttrFilter,
};
