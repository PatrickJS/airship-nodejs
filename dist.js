"use strict";

var _superagent = _interopRequireDefault(require("superagent"));

var _ajv = _interopRequireDefault(require("ajv"));

var _package = require("./package.json");

var _md = _interopRequireDefault(require("md5"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _slicedToArray(arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return _sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var SERVER_URL = 'https://api.airshiphq.com';
var IDENTIFY_ENDPOINT = "".concat(SERVER_URL, "/v1/identify");
var GATING_INFO_ENDPOINT = "".concat(SERVER_URL, "/v1/gating-info");
var PLATFORM = 'nodejs';
var VERSION = _package.version;
var SDK_VERSION = "".concat(PLATFORM, ":").concat(VERSION);
var CONTROL_TYPE_BOOLEAN = 'boolean';
var CONTROL_TYPE_MULTIVARIATE = 'multivariate';
var DISTRIBUTION_TYPE_RULE_BASED = 'R';
var DISTRIBUTION_TYPE_PERCENTAGE_BASED = 'P';
var OBJECT_ATTRIBUTE_TYPE_STRING = 'STRING';
var OBJECT_ATTRIBUTE_TYPE_INT = 'INT';
var OBJECT_ATTRIBUTE_TYPE_FLOAT = 'FLOAT';
var OBJECT_ATTRIBUTE_TYPE_BOOLEAN = 'BOOLEAN';
var OBJECT_ATTRIBUTE_TYPE_DATE = 'DATE';
var OBJECT_ATTRIBUTE_TYPE_DATETIME = 'DATETIME';
var RULE_OPERATOR_TYPE_IS = 'IS';
var RULE_OPERATOR_TYPE_IS_NOT = 'IS_NOT';
var RULE_OPERATOR_TYPE_IN = 'IN';
var RULE_OPERATOR_TYPE_NOT_IN = 'NOT_IN';
var RULE_OPERATOR_TYPE_LT = 'LT';
var RULE_OPERATOR_TYPE_LTE = 'LTE';
var RULE_OPERATOR_TYPE_GT = 'GT';
var RULE_OPERATOR_TYPE_GTE = 'GTE';
var RULE_OPERATOR_TYPE_FROM = 'FROM';
var RULE_OPERATOR_TYPE_UNTIL = 'UNTIL';
var RULE_OPERATOR_TYPE_AFTER = 'AFTER';
var RULE_OPERATOR_TYPE_BEFORE = 'BEFORE';
var SCHEMA = {
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "pattern": "^([A-Z][a-zA-Z]*)+$",
      "maxLength": 50
    },
    "isGroup": {
      "type": "boolean"
    },
    "id": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1
    },
    "displayName": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1
    },
    "attributes": {
      "type": "object",
      "patternProperties": {
        "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
          "oneOf": [{
            "type": "string",
            "maxLength": 3000
          }, {
            "type": "boolean"
          }, {
            "type": "number"
          }]
        }
      },
      "maxProperties": 100,
      "additionalProperties": false
    },
    "group": {
      "type": ["object", "null"],
      "properties": {
        "type": {
          "type": "string",
          "pattern": "^([A-Z][a-zA-Z]*)+$",
          "maxLength": 50
        },
        "isGroup": {
          "type": "boolean",
          "enum": [true]
        },
        "id": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1
        },
        "displayName": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1
        },
        "attributes": {
          "type": "object",
          "patternProperties": {
            "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
              "oneOf": [{
                "type": "string",
                "maxLength": 3000
              }, {
                "type": "boolean"
              }, {
                "type": "number"
              }]
            }
          },
          "maxProperties": 100,
          "additionalProperties": false
        }
      },
      "required": ["id", "displayName"],
      "additionalProperties": false
    }
  },
  "required": ["type", "id", "displayName"],
  "additionalProperties": false
};

var makeid = function makeid() {
  var text = '';
  var possible = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  for (var i = 0; i < 6; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
};

var SDK_ID = makeid();

var getHashedValue = function getHashedValue(s) {
  return parseInt((0, _md.default)(s), 16) * 1.0 / 340282366920938463463374607431768211455;
};

var Airship = function Airship(options, cb) {
  _classCallCheck(this, Airship);

  _initialiseProps.call(this);

  this.apiKey = options.apiKey;
  this.envKey = options.envKey;
  this.timeout = options.timeout || 10000;

  this.transformer = options.transformer || function (x) {
    return x;
  }; // This is passed a reason.


  this.gatingInfoErrorCb = options.gatingInfoErrorCb || function () {
    console.error('Airship: failed to retrieve gating info.');
  };

  this.gatingInfo = null; // Used to check whether we are already trying to get gatingInfo.

  this.gatingInfoPromise = null;
  this.gatingInfoMap = null;
  var hardMaxGateStatsBatchSize = 500;
  this.maxGateStatsBatchSize = options.maxGateStatsBatchSize !== undefined // Allow 0 for no batching
  ? Math.min(Math.max(options.maxGateStatsBatchSize, 0), hardMaxGateStatsBatchSize) : hardMaxGateStatsBatchSize;
  this.gateStatsUploadBatchInterval = options.gateStatsUploadBatchInterval !== undefined // Allow 0 for BatchInterval -> immediate
  ? Math.max(options.gateStatsUploadBatchInterval, 0) : 60 * 1000; // in milliseconds
  // This is the timer from setInterval for uploading stats. This timer is cleared and recreated
  // when the batch size is reached, ensuring that stats upload requests are always triggered
  // within options.gateStatsUploadBatchInterval seconds of the event.
  // More than one upload stats requests can simultaneously be in flight (unlike rules)

  this.gateStatsUploadTimeout = null;
  this.gateStatsBatch = [];
  var ajv = (0, _ajv.default)();
  this.validate = ajv.compile(SCHEMA);
} // If this is passed a callback as an argument, the arguments null, true will be passed on success,
// or an Error will be passed on failure.
// If this is not passed a callback as an argument, this will return a Promise that resolves when
// initialization is complete.
;

var _initialiseProps = function _initialiseProps() {
  var _this = this;

  Object.defineProperty(this, "init", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(cb) {
      if (_this.gateStatsUploadBatchInterval > 0) {
        _this.gateStatsUploadTimeout = setInterval(_this.triggerUploadStats, _this.gateStatsUploadBatchInterval);
      }

      var getGatingInfoPromise = function getGatingInfoPromise() {
        return _superagent.default.get("".concat(GATING_INFO_ENDPOINT, "/").concat(_this.envKey)).set('api-key', _this.apiKey).set('sdk-version', SDK_VERSION).timeout(_this.timeout);
      }; // TODO: remove this fake one


      var getFakeGatingInfoPromise = function getFakeGatingInfoPromise() {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            var gatingInfo = {
              timestamp: Date.now()
            };
            console.log('Airship: retrieved gatingInfo ', gatingInfo);
            resolve(gatingInfo);
          }, 500);
        });
      };

      var maybeGetGatingInfoPromise = function maybeGetGatingInfoPromise() {
        if (_this.gatingInfoPromise) {
          return;
        }

        _this.gatingInfoPromise = getGatingInfoPromise().then(function (res) {
          var gatingInfo = res.body;

          if (gatingInfo.serverInfo === 'maintenance') {
            _this.gatingInfoPromise = null;
          } else {
            var gatingInfoMap = _this._getGatingInfoMap(gatingInfo);

            _this.gatingInfo = gatingInfo;
            _this.gatingInfoMap = gatingInfoMap;
            _this.gatingInfoPromise = null;
          }
        }).catch(function (err) {
          _this.gatingInfoPromise = null;

          _this.gatingInfoErrorCb(err);

          throw err; // TODO: important, need to catch inside the setInterval
        });
        return _this.gatingInfoPromise;
      };

      var initialGatingInfoPromise = maybeGetGatingInfoPromise();
      setInterval(function () {
        maybeGetGatingInfoPromise().catch(function (err) {// Catch the error, but ignore or notify.
        });
      }, 60 * 1000);

      if (cb) {
        initialGatingInfoPromise.then(function () {
          return cb(null, true);
        }).catch(function () {
          return cb(new Error('Airship: failed to initialize, will re-try in five (5) minutes.'));
        });
        return;
      }

      return initialGatingInfoPromise;
    }
  });
  Object.defineProperty(this, "triggerUploadStats", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value() {
      if (_this.gateStatsBatch.length === 0) {
        return;
      }

      var getUploadStatsPromise = function getUploadStatsPromise() {
        var payload = _this.gateStatsBatch;
        _this.gateStatsBatch = []; // TODO: error handling on triggerUploadStats - do we try again?
        // not right now, but we could add .then() referring to `payload` to put it back in the gateStatsBatch
        // TODO: get the url for this request

        return _superagent.default.post(IDENTIFY_ENDPOINT).type('application/json').set('api-key', _this.apiKey).timeout(_this.timeout).send({
          envKey: _this.envKey,
          objects: payload
        }).then(function () {}).catch(function () {});
      }; // TODO: remove this fake one. The entire function body can be replaced with the new one after


      var getFakeUploadStatsPromise = function getFakeUploadStatsPromise() {
        var payload = _this.gateStatsBatch;
        _this.gateStatsBatch = [];
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            console.log('Airship: uploaded stats ', payload);
            resolve();
          }, 500);
        });
      };

      return getUploadStatsPromise();
    }
  });
  Object.defineProperty(this, "_getGatingInfoMap", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(gatingInfo) {
      var map = {};
      var controls = gatingInfo.controls;

      for (var i = 0; i < controls.length; i++) {
        var control = controls[i];
        var controlInfo = {};
        controlInfo.id = control.id;
        controlInfo.isOn = control.isOn;
        controlInfo.ruleBasedDistributionDefaultVariation = control.ruleBasedDistributionDefaultVariation;
        controlInfo.ruleSets = control.ruleSets;
        controlInfo.distributions = control.distributions;
        controlInfo.type = control.type;
        controlInfo.defaultVariation = control.defaultVariation;
        var enablements = control.enablements;
        var enablementsInfo = {};

        for (var j = 0; j < enablements.length; j++) {
          var enablement = enablements[j];
          var clientIdentitiesMap = enablementsInfo[enablement.clientObjectTypeName];

          if (clientIdentitiesMap === undefined) {
            enablementsInfo[enablement.clientObjectTypeName] = {};
          }

          enablementsInfo[enablement.clientObjectTypeName][enablement.clientObjectIdentity] = [enablement.isEnabled, enablement.variation];
        }

        controlInfo.enablementsInfo = enablementsInfo;
        map[control.shortName] = controlInfo;
      }

      return map;
    }
  });
  Object.defineProperty(this, "_uploadStatsAsync", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(gateStats) {
      _this.gateStatsBatch.push(gateStats);

      if (_this.gateStatsUploadBatchInterval === 0) {
        setImmediate(_this.triggerUploadStats);
        return;
      }

      if (_this.gateStatsBatch.length >= _this.maxGateStatsBatchSize) {
        setImmediate(_this.triggerUploadStats); // recreate the setInterval Timeout

        clearInterval(_this.gateStatsUploadTimeout);
        _this.gateStatsUploadTimeout = setInterval(_this.triggerUploadStats, _this.gateStatsUploadBatchInterval);
      }
    }
  });
  Object.defineProperty(this, "_satisfiesRule", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(rule, object) {
      var attributeType = rule.attributeType;
      var operator = rule.operator;
      var attributeName = rule.attributeName;
      var value = rule.value;
      var valueList = rule.valueList;

      if (object.attributes === undefined || object.attributes[attributeName] === undefined) {
        return false;
      }

      var attributeVal = object.attributes[attributeName];

      if (attributeType === OBJECT_ATTRIBUTE_TYPE_STRING) {
        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else if (operator === RULE_OPERATOR_TYPE_IN) {
          return valueList.indexOf(attributeVal) >= 0;
        } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
          return valueList.indexOf(attributeVal) === -1;
        } else {
          return false;
        }
      } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_INT) {
        value = value && parseInt(value);
        valueList = valueList && valueList.map(function (v) {
          return parseInt(v);
        });

        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else if (operator === RULE_OPERATOR_TYPE_IN) {
          return valueList.indexOf(attributeVal) >= 0;
        } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
          return valueList.indexOf(attributeVal) === -1;
        } else if (operator === RULE_OPERATOR_TYPE_LT) {
          return attributeVal < value;
        } else if (operator === RULE_OPERATOR_TYPE_LTE) {
          return attributeVal <= value;
        } else if (operator === RULE_OPERATOR_TYPE_GT) {
          return attributeVal > value;
        } else if (operator === RULE_OPERATOR_TYPE_GTE) {
          return attributeVal >= value;
        } else {
          return false;
        }
      } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_FLOAT) {
        value = value && parseFloat(value);
        valueList = valueList && valueList.map(function (v) {
          return parseFloat(v);
        });

        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else if (operator === RULE_OPERATOR_TYPE_IN) {
          return valueList.indexOf(attributeVal) >= 0;
        } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
          return valueList.indexOf(attributeVal) === -1;
        } else if (operator === RULE_OPERATOR_TYPE_LT) {
          return attributeVal < value;
        } else if (operator === RULE_OPERATOR_TYPE_LTE) {
          return attributeVal <= value;
        } else if (operator === RULE_OPERATOR_TYPE_GT) {
          return attributeVal > value;
        } else if (operator === RULE_OPERATOR_TYPE_GTE) {
          return attributeVal >= value;
        } else {
          return false;
        }
      } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_BOOLEAN) {
        value = value === 'true' ? true : false;

        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else {
          return false;
        }
      } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_DATE) {
        var unixTimestamp = new Date(attributeVal).getTime();

        if (isNaN(unixTimestamp)) {
          return false;
        }

        var isoFormat = new Date(attributeVal).toISOString();

        if (!isoFormat.endsWith('T00:00:00.000Z')) {
          return false;
        }

        value = value && new Date(value).getTime();
        valueList = valueList && valueList.map(function (v) {
          return new Date(v).getTime();
        });
        attributeVal = unixTimestamp;

        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else if (operator === RULE_OPERATOR_TYPE_IN) {
          return valueList.indexOf(attributeVal) >= 0;
        } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
          return valueList.indexOf(attributeVal) === -1;
        } else if (operator === RULE_OPERATOR_TYPE_FROM) {
          return attributeVal >= value;
        } else if (operator === RULE_OPERATOR_TYPE_UNTIL) {
          return attributeVal <= value;
        } else if (operator === RULE_OPERATOR_TYPE_AFTER) {
          return attributeVal > value;
        } else if (operator === RULE_OPERATOR_TYPE_BEFORE) {
          return attributeVal < value;
        } else {
          return false;
        }
      } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_DATETIME) {
        value = value && new Date(value).getTime();
        valueList = valueList && valueList.map(function (v) {
          return new Date(v).getTime();
        });
        attributeVal = new Date(attributeVal).getTime();

        if (isNaN(attributeVal)) {
          return false;
        }

        if (operator === RULE_OPERATOR_TYPE_IS) {
          return attributeVal === value;
        } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
          return attributeVal !== value;
        } else if (operator === RULE_OPERATOR_TYPE_IN) {
          return valueList.indexOf(attributeVal) >= 0;
        } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
          return valueList.indexOf(attributeVal) === -1;
        } else if (operator === RULE_OPERATOR_TYPE_FROM) {
          return attributeVal >= value;
        } else if (operator === RULE_OPERATOR_TYPE_UNTIL) {
          return attributeVal <= value;
        } else if (operator === RULE_OPERATOR_TYPE_AFTER) {
          return attributeVal > value;
        } else if (operator === RULE_OPERATOR_TYPE_BEFORE) {
          return attributeVal < value;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
  });
  Object.defineProperty(this, "_getGateValuesForObject", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(controlInfo, object) {
      if (controlInfo.enablementsInfo[object.type] !== undefined) {
        if (controlInfo.enablementsInfo[object.type][object.id] !== undefined) {
          var _controlInfo$enableme = _slicedToArray(controlInfo.enablementsInfo[object.type][object.id], 2),
              isEnabled = _controlInfo$enableme[0],
              variation = _controlInfo$enableme[1];

          return {
            isEnabled: isEnabled,
            variation: variation,
            isEligible: isEnabled,
            _fromEnablement: true
          };
        }
      }

      var sampledInsideBasePopulation = false;

      for (var i = 0; i < controlInfo.ruleSets.length; i++) {
        if (sampledInsideBasePopulation) {
          break;
        }

        var ruleSet = controlInfo.ruleSets[i];
        var rules = ruleSet.rules;

        if (ruleSet.clientObjectTypeName !== object.type) {
          continue;
        }

        var satisfiesAllRules = true;

        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          satisfiesAllRules = satisfiesAllRules && _this._satisfiesRule(rule, object);
        }

        if (satisfiesAllRules) {
          var hashKey = "SAMPLING:control_".concat(controlInfo.id, ":env_").concat(_this.gatingInfo.env.id, ":rule_set_").concat(ruleSet.id, ":client_object_").concat(object.type, "_").concat(object.id);

          if (getHashedValue(hashKey) <= ruleSet.samplingPercentage) {
            sampledInsideBasePopulation = true;
          }
        }
      }

      if (!sampledInsideBasePopulation) {
        return {
          isEnabled: false,
          variation: null,
          isEligible: false
        };
      }

      if (controlInfo.type === CONTROL_TYPE_BOOLEAN) {
        return {
          isEnabled: true,
          variation: null,
          isEligible: true
        };
      } else if (controlInfo.type === CONTROL_TYPE_MULTIVARIATE) {
        if (controlInfo.distributions.length === 0) {
          return {
            isEnabled: true,
            variation: controlInfo.defaultVariation,
            isEligible: true
          };
        }

        var percentageBasedDistributions = controlInfo.distributions.filter(function (d) {
          return d.type === DISTRIBUTION_TYPE_PERCENTAGE_BASED;
        });
        var ruleBasedDistributions = controlInfo.distributions.filter(function (d) {
          return d.type === DISTRIBUTION_TYPE_RULE_BASED;
        });

        if (percentageBasedDistributions.length !== 0 && ruleBasedDistributions.length !== 0) {
          console.error('Rule integrity error: please contact support@airshiphq.com');
          return {
            isEnabled: false,
            variation: null,
            isEligible: false
          };
        }

        if (percentageBasedDistributions.length !== 0) {
          var delta = 0.0001;
          var sum_percentages = 0.0;
          var running_percentages = [];

          for (var _i2 = 0; _i2 < percentageBasedDistributions.length; _i2++) {
            var distribution = percentageBasedDistributions[_i2];
            sum_percentages += distribution.percentage;

            if (running_percentages.length === 0) {
              running_percentages.push(distribution.percentage);
            } else {
              running_percentages.push(running_percentages[running_percentages.length - 1] + distribution.percentage);
            }
          }

          if (Math.abs(1.0 - sum_percentages) > delta) {
            console.error('Rule integrity error: please contact support@airshiphq.com');
            return {
              isEnabled: false,
              variation: null,
              isEligible: false
            };
          }

          var _hashKey = "DISTRIBUTION:control_".concat(controlInfo.id, ":env_").concat(_this.gatingInfo.env.id, ":client_object_").concat(object.type, "_").concat(object.id);

          var hashedPercentage = getHashedValue(_hashKey);

          for (var _i3 = 0; _i3 < running_percentages.length; _i3++) {
            var percentage = running_percentages[_i3];

            if (hashedPercentage <= percentage) {
              return {
                isEnabled: true,
                variation: percentageBasedDistributions[_i3].variation,
                isEligible: true
              };
            }
          }

          return {
            isEnabled: true,
            variation: percentageBasedDistributions[percentageBasedDistributions.length - 1].variation,
            isEligible: true
          };
        } else {
          for (var _i4 = 0; _i4 < ruleBasedDistributions.length; _i4++) {
            var _distribution = ruleBasedDistributions[_i4];
            var _ruleSet = _distribution.ruleSet;
            var _rules = _ruleSet.rules;

            if (_ruleSet.clientObjectTypeName !== object.type) {
              continue;
            }

            var _satisfiesAllRules = true;

            for (var _j = 0; _j < _rules.length; _j++) {
              var _rule = _rules[_j];
              _satisfiesAllRules = _satisfiesAllRules && _this._satisfiesRule(_rule, object);
            }

            if (_satisfiesAllRules) {
              return {
                isEnabled: true,
                variation: _distribution.variation,
                isEligible: true
              };
            }
          }

          return {
            isEnabled: true,
            variation: controlInfo.ruleBasedDistributionDefaultVariation || controlInfo.defaultVariation,
            isEligible: true,
            _ruleBasedDefaultVariation: true
          };
        }
      } else {
        return {
          isEnabled: false,
          variation: null,
          isEligible: false
        };
      }
    }
  });
  Object.defineProperty(this, "_getGateValues", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(controlShortName, object) {
      if (_this.gatingInfoMap[controlShortName] === undefined) {
        return {
          isEnabled: false,
          variation: null,
          isEligible: false,
          _shouldSendStats: false
        };
      }

      var controlInfo = _this.gatingInfoMap[controlShortName];

      if (!controlInfo.isOn) {
        return {
          isEnabled: false,
          variation: null,
          isEligible: false,
          _shouldSendStats: true
        };
      }

      var group = null;

      if (object.group !== undefined) {
        group = object.group;
      }

      var result = _this._getGateValuesForObject(controlInfo, object);

      if (group !== null) {
        if (group.type == undefined) {
          group.type = "".concat(object.type, "Group");
          group.isGroup = true;
        }

        var groupResult = _this._getGateValuesForObject(controlInfo, group);

        if (result._fromEnablement && !result.isEnabled) {// Do nothing
        } else if (!result._fromEnablement && groupResult._fromEnablement && !groupResult.isEnabled) {
          result.isEnabled = groupResult.isEnabled;
          result.variation = groupResult.variation;
          result.isEligible = groupResult.isEligible;
        } else if (result.isEnabled) {
          if (result._ruleBasedDefaultVariation) {
            if (groupResult.isEnabled) {
              result.isEnabled = groupResult.isEnabled;
              result.variation = groupResult.variation;
              result.isEligible = groupResult.isEligible;
            } else {// Do nothing
            }
          } else {// Do nothing
            }
        } else if (groupResult.isEnabled) {
          result.isEnabled = groupResult.isEnabled;
          result.variation = groupResult.variation;
          result.isEligible = groupResult.isEligible;
        } else {// Do nothing
        }
      }

      result._shouldSendStats = true;
      return result;
    }
  });
  Object.defineProperty(this, "_cloneObject", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(object) {
      var clone = Object.assign({}, object);

      if (object.attributes !== undefined) {
        clone.attributes = Object.assign({}, object.attributes);
      }

      if (object.group !== undefined) {
        clone.group = Object.assign({}, object.group);

        if (object.group.attributes !== undefined) {
          clone.group.attributes = Object.assign({}, object.group.attributes);
        }
      }

      return clone;
    }
  });
  Object.defineProperty(this, "_validateNesting", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(object) {
      if (object.isGroup === true && object.group !== undefined) {
        return 'A group cannot be nested inside another group';
      }

      return null;
    }
  });
  Object.defineProperty(this, "isEnabled", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(controlShortName, object) {
      if (_this.gatingInfoMap === null) {
        return false;
      }

      var valid = _this.validate(object);

      if (!valid) {
        console.error(_this.validate.errors);
        return false;
      }

      object = _this._cloneObject(object);

      var error = _this._validateNesting(object);

      if (error) {
        console.error(error);
        return false;
      }

      var gateTimestamp = new Date().toISOString();
      var start = process.hrtime();

      var _this$_getGateValues = _this._getGateValues(controlShortName, object),
          isEnabled = _this$_getGateValues.isEnabled,
          variation = _this$_getGateValues.variation,
          isEligible = _this$_getGateValues.isEligible,
          _shouldSendStats = _this$_getGateValues._shouldSendStats;

      var end = process.hrtime(start);

      if (_shouldSendStats) {
        var sdkGateTimestamp = gateTimestamp;
        var sdkGateLatency = "".concat(end[1] / 1000.0, "us");
        var sdkVersion = SDK_VERSION;
        var stats = {};
        stats.sdkGateControlShortName = controlShortName;
        stats.sdkGateTimestamp = sdkGateTimestamp;
        stats.sdkGateLatency = sdkGateLatency;
        stats.sdkVersion = sdkVersion;
        stats.sdkId = SDK_ID;
        object.stats = stats;

        _this._uploadStatsAsync(object);
      }

      return isEnabled;
    }
  });
  Object.defineProperty(this, "getVariation", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(controlShortName, object) {
      if (_this.gatingInfoMap === null) {
        return null;
      }

      var valid = _this.validate(object);

      if (!valid) {
        console.error(_this.validate.errors);
        return null;
      }

      object = _this._cloneObject(object);

      var error = _this._validateNesting(object);

      if (error) {
        console.error(error);
        return null;
      }

      var gateTimestamp = new Date().toISOString();
      var start = process.hrtime();

      var _this$_getGateValues2 = _this._getGateValues(object),
          isEnabled = _this$_getGateValues2.isEnabled,
          variation = _this$_getGateValues2.variation,
          isEligible = _this$_getGateValues2.isEligible,
          _shouldSendStats = _this$_getGateValues2._shouldSendStats;

      var end = process.hrtime(start);

      if (_shouldSendStats) {
        var sdkGateTimestamp = gateTimestamp;
        var sdkGateLatency = "".concat(end[1] / 1000.0, "us");
        var sdkVersion = SDK_VERSION;
        var stats = {};
        stats.sdkGateControlShortName = controlShortName;
        stats.sdkGateTimestamp = sdkGateTimestamp;
        stats.sdkGateLatency = sdkGateLatency;
        stats.sdkVersion = sdkVersion;
        stats.sdkId = SDK_ID;
        object.stats = stats;

        _this._uploadStatsAsync(object);
      }

      return variation;
    }
  });
  Object.defineProperty(this, "isEligible", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function value(controlShortName, object) {
      if (_this.gatingInfoMap === null) {
        return false;
      }

      var valid = _this.validate(object);

      if (!valid) {
        console.error(_this.validate.errors);
        return false;
      }

      object = _this._cloneObject(object);

      var error = _this._validateNesting(object);

      if (error) {
        console.error(error);
        return false;
      }

      var gateTimestamp = new Date().toISOString();
      var start = process.hrtime();

      var _this$_getGateValues3 = _this._getGateValues(object),
          isEnabled = _this$_getGateValues3.isEnabled,
          variation = _this$_getGateValues3.variation,
          isEligible = _this$_getGateValues3.isEligible,
          _shouldSendStats = _this$_getGateValues3._shouldSendStats;

      var end = process.hrtime(start);

      if (_shouldSendStats) {
        var sdkGateTimestamp = gateTimestamp;
        var sdkGateLatency = "".concat(end[1] / 1000.0, "us");
        var sdkVersion = SDK_VERSION;
        var stats = {};
        stats.sdkGateControlShortName = controlShortName;
        stats.sdkGateTimestamp = sdkGateTimestamp;
        stats.sdkGateLatency = sdkGateLatency;
        stats.sdkVersion = sdkVersion;
        stats.sdkId = SDK_ID;
        object.stats = stats;

        _this._uploadStatsAsync(object);
      }

      return isEligible;
    }
  });
};

exports = module.exports = Airship;

