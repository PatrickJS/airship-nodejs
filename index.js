import request from 'superagent'
import Ajv from 'ajv'
import { version } from './package.json'
import md5 from 'md5'

const SERVER_URL = 'https://api.airshiphq.com'
const IDENTIFY_ENDPOINT = `${SERVER_URL}/v1/identify`
const GATING_INFO_ENDPOINT = `${SERVER_URL}/v1/gating-info`
const PLATFORM = 'nodejs'
const VERSION = version

const SDK_VERSION = `${PLATFORM}:${VERSION}`

const CONTROL_TYPE_BOOLEAN = 'boolean'
const CONTROL_TYPE_MULTIVARIATE = 'multivariate'

const DISTRIBUTION_TYPE_RULE_BASED = 'R'
const DISTRIBUTION_TYPE_PERCENTAGE_BASED = 'P'

const OBJECT_ATTRIBUTE_TYPE_STRING = 'STRING'
const OBJECT_ATTRIBUTE_TYPE_INT = 'INT'
const OBJECT_ATTRIBUTE_TYPE_FLOAT = 'FLOAT'
const OBJECT_ATTRIBUTE_TYPE_BOOLEAN = 'BOOLEAN'
const OBJECT_ATTRIBUTE_TYPE_DATE = 'DATE'
const OBJECT_ATTRIBUTE_TYPE_DATETIME = 'DATETIME'

const RULE_OPERATOR_TYPE_IS = 'IS'
const RULE_OPERATOR_TYPE_IS_NOT = 'IS_NOT'
const RULE_OPERATOR_TYPE_IN = 'IN'
const RULE_OPERATOR_TYPE_NOT_IN = 'NOT_IN'
const RULE_OPERATOR_TYPE_LT = 'LT'
const RULE_OPERATOR_TYPE_LTE = 'LTE'
const RULE_OPERATOR_TYPE_GT = 'GT'
const RULE_OPERATOR_TYPE_GTE = 'GTE'
const RULE_OPERATOR_TYPE_FROM = 'FROM'
const RULE_OPERATOR_TYPE_UNTIL = 'UNTIL'
const RULE_OPERATOR_TYPE_AFTER = 'AFTER'
const RULE_OPERATOR_TYPE_BEFORE = 'BEFORE'

const SCHEMA = {
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "pattern": "^([A-Z][a-zA-Z]*)+$",
      "maxLength": 50,
    },
    "isGroup": {
      "type": "boolean",
    },
    "id": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1,
    },
    "displayName": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1,
    },
    "attributes": {
      "type": "object",
      "patternProperties": {
        "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 3000,
            },
            {
              "type": "boolean"
            },
            {
              "type": "number"
            },
          ],
        },
      },
      "maxProperties": 100,
      "additionalProperties": false,
    },
    "group": {
      "type": ["object", "null"],
      "properties": {
        "type": {
          "type": "string",
          "pattern": "^([A-Z][a-zA-Z]*)+$",
          "maxLength": 50,
        },
        "isGroup": {
          "type": "boolean",
          "enum": [true],
        },
        "id": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1,
        },
        "displayName": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1,
        },
        "attributes": {
          "type": "object",
          "patternProperties": {
            "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
              "oneOf": [
                {
                  "type": "string",
                  "maxLength": 3000,
                },
                {
                  "type": "boolean"
                },
                {
                  "type": "number"
                },
              ],
            },
          },
          "maxProperties": 100,
          "additionalProperties": false,
        },
      },
      "required": ["id", "displayName"],
      "additionalProperties": false,
    },
  },
  "required": ["type", "id", "displayName"],
  "additionalProperties": false,
}

const makeid = () => {
  let text = ''
  let possible = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  for (let i = 0; i < 6; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }

  return text
}

const SDK_ID = makeid()


const getHashedValue = (s) => {
  return parseInt(md5(s), 16) * 1.0 / 340282366920938463463374607431768211455
}

class Airship {
  constructor(options, cb) {
    this.apiKey = options.apiKey
    this.envKey = options.envKey
    this.timeout = options.timeout || 10000
    this.transformer = options.transformer || (x => x)

    // This is passed a reason.
    this.gatingInfoErrorCb = options.gatingInfoErrorCb || (() => { console.error('Airship: failed to retrieve gating info.') })
    this.gatingInfo = null
    // Used to check whether we are already trying to get gatingInfo.
    this.gatingInfoPromise = null
    this.gatingInfoMap = null

    let hardMaxGateStatsBatchSize = 500
    this.maxGateStatsBatchSize = options.maxGateStatsBatchSize !== undefined // Allow 0 for no batching
      ? Math.min(Math.max(options.maxGateStatsBatchSize, 0), hardMaxGateStatsBatchSize) : hardMaxGateStatsBatchSize
    this.gateStatsUploadBatchInterval = options.gateStatsUploadBatchInterval !== undefined // Allow 0 for BatchInterval -> immediate
      ? Math.max(options.gateStatsUploadBatchInterval, 0) : 60 * 1000 // in milliseconds
    // This is the timer from setInterval for uploading stats. This timer is cleared and recreated
    // when the batch size is reached, ensuring that stats upload requests are always triggered
    // within options.gateStatsUploadBatchInterval seconds of the event.
    // More than one upload stats requests can simultaneously be in flight (unlike rules)
    this.gateStatsUploadTimeout = null
    this.gateStatsBatch = []
    let ajv = Ajv()
    this.validate = ajv.compile(SCHEMA)
  }

  // If this is passed a callback as an argument, the arguments null, true will be passed on success,
  // or an Error will be passed on failure.
  // If this is not passed a callback as an argument, this will return a Promise that resolves when
  // initialization is complete.
  init = (cb) => {
    if (this.gateStatsUploadBatchInterval > 0) {
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval)
    }

    let getGatingInfoPromise = () => {
      return request.get(`${GATING_INFO_ENDPOINT}/${this.envKey}`)
        .set('api-key', this.apiKey)
        .set('sdk-version', SDK_VERSION)
        .timeout(this.timeout)
    }

    // TODO: remove this fake one
    let getFakeGatingInfoPromise = () => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let gatingInfo = {
            timestamp: Date.now()
          }
          console.log('Airship: retrieved gatingInfo ', gatingInfo)
          resolve(gatingInfo)
        }, 500)
      })
    }

    let maybeGetGatingInfoPromise = () => {
      if (this.gatingInfoPromise) {
        return
      }

      this.gatingInfoPromise = getGatingInfoPromise().then(res => {
        let gatingInfo = res.body

        if (gatingInfo.serverInfo === 'maintenance') {
          this.gatingInfoPromise = null
        } else {
          let gatingInfoMap = this._getGatingInfoMap(gatingInfo)

          this.gatingInfo = gatingInfo
          this.gatingInfoMap = gatingInfoMap
          this.gatingInfoPromise = null
        }
      }).catch(err => {
        this.gatingInfoPromise = null
        this.gatingInfoErrorCb(err)
        throw err // TODO: important, need to catch inside the setInterval
      })
      return this.gatingInfoPromise
    }

    let initialGatingInfoPromise = maybeGetGatingInfoPromise()
    setInterval(() => {
      maybeGetGatingInfoPromise().catch(err => {
        // Catch the error, but ignore or notify.
      })
    }, 60 * 1000)

    if (cb) {
      initialGatingInfoPromise
        .then(() => cb(null, true))
        .catch(() => cb(new Error('Airship: failed to initialize, will re-try in five (5) minutes.')))
      return
    }

    return initialGatingInfoPromise
  }

  triggerUploadStats = () => {
    if (this.gateStatsBatch.length === 0) {
      return
    }

    let getUploadStatsPromise = () => {
      let payload = this.gateStatsBatch
      this.gateStatsBatch = []

      // TODO: error handling on triggerUploadStats - do we try again?
      // not right now, but we could add .then() referring to `payload` to put it back in the gateStatsBatch

      // TODO: get the url for this request
      return request.post(IDENTIFY_ENDPOINT)
        .type('application/json')
        .set('api-key', this.apiKey)
        .timeout(this.timeout)
        .send({
          envKey: this.envKey,
          objects: payload,
        }).then(() => {}).catch(() => {})
    }

    // TODO: remove this fake one. The entire function body can be replaced with the new one after
    let getFakeUploadStatsPromise = () => {
      let payload = this.gateStatsBatch
      this.gateStatsBatch = []
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          console.log('Airship: uploaded stats ', payload)
          resolve()
        }, 500)
      })
    }

    return getUploadStatsPromise()
  }

  _getGatingInfoMap = (gatingInfo) => {
    let map = {}

    let controls = gatingInfo.controls

    for (let i = 0; i < controls.length; i++) {
      let control = controls[i]
      let controlInfo = {}

      controlInfo.id = control.id
      controlInfo.isOn = control.isOn
      controlInfo.ruleBasedDistributionDefaultVariation = control.ruleBasedDistributionDefaultVariation
      controlInfo.ruleSets = control.ruleSets
      controlInfo.distributions = control.distributions
      controlInfo.type = control.type
      controlInfo.defaultVariation = control.defaultVariation

      let enablements = control.enablements
      let enablementsInfo = {}

      for (let j = 0; j < enablements.length; j++) {
        let enablement = enablements[j]

        let clientIdentitiesMap = enablementsInfo[enablement.clientObjectTypeName]

        if (clientIdentitiesMap === undefined) {
          enablementsInfo[enablement.clientObjectTypeName] = {}
        }

        enablementsInfo[enablement.clientObjectTypeName][enablement.clientObjectIdentity] = [enablement.isEnabled, enablement.variation]
      }

      controlInfo.enablementsInfo = enablementsInfo

      map[control.shortName] = controlInfo
    }

    return map
  }

  _uploadStatsAsync = (gateStats) => {
    this.gateStatsBatch.push(gateStats)
    if (this.gateStatsUploadBatchInterval === 0) {
      setImmediate(this.triggerUploadStats)
      return
    }

    if (this.gateStatsBatch.length >= this.maxGateStatsBatchSize) {
      setImmediate(this.triggerUploadStats)
      // recreate the setInterval Timeout
      clearInterval(this.gateStatsUploadTimeout)
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval)
    }
  }

  _satisfiesRule = (rule, object) => {
    let attributeType = rule.attributeType
    let operator = rule.operator
    let attributeName = rule.attributeName
    let value = rule.value
    let valueList = rule.valueList

    if (object.attributes === undefined || object.attributes[attributeName] === undefined) {
      return false
    }

    let attributeVal = object.attributes[attributeName]

    if (attributeType === OBJECT_ATTRIBUTE_TYPE_STRING) {
      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else if (operator === RULE_OPERATOR_TYPE_IN) {
        return valueList.indexOf(attributeVal) >= 0
      } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
        return valueList.indexOf(attributeVal) === -1
      } else {
        return false
      }
    } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_INT) {
      value = value && parseInt(value)
      valueList = valueList && valueList.map(v => parseInt(v))

      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else if (operator === RULE_OPERATOR_TYPE_IN) {
        return valueList.indexOf(attributeVal) >= 0
      } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
        return valueList.indexOf(attributeVal) === -1
      } else if (operator === RULE_OPERATOR_TYPE_LT) {
        return attributeVal < value
      } else if (operator === RULE_OPERATOR_TYPE_LTE) {
        return attributeVal <= value
      } else if (operator === RULE_OPERATOR_TYPE_GT) {
        return attributeVal > value
      } else if (operator === RULE_OPERATOR_TYPE_GTE) {
        return attributeVal >= value
      } else {
        return false
      }
    } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_FLOAT) {
      value = value && parseFloat(value)
      valueList = valueList && valueList.map(v => parseFloat(v))

      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else if (operator === RULE_OPERATOR_TYPE_IN) {
        return valueList.indexOf(attributeVal) >= 0
      } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
        return valueList.indexOf(attributeVal) === -1
      } else if (operator === RULE_OPERATOR_TYPE_LT) {
        return attributeVal < value
      } else if (operator === RULE_OPERATOR_TYPE_LTE) {
        return attributeVal <= value
      } else if (operator === RULE_OPERATOR_TYPE_GT) {
        return attributeVal > value
      } else if (operator === RULE_OPERATOR_TYPE_GTE) {
        return attributeVal >= value
      } else {
        return false
      }
    } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_BOOLEAN) {
      value = (value === 'true') ? true : false
      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else {
        return false
      }
    } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_DATE) {
      value = value && (new Date(value)).getTime()
      valueList = valueList && valueList.map(v => (new Date(v)).getTime())

      attributeVal = (new Date(attributeVal)).getTime()

      if (isNaN(attributeVal)) {
        return false
      }

      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else if (operator === RULE_OPERATOR_TYPE_IN) {
        return valueList.indexOf(attributeVal) >= 0
      } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
        return valueList.indexOf(attributeVal) === -1
      } else if (operator === RULE_OPERATOR_TYPE_FROM) {
        return attributeVal >= value
      } else if (operator === RULE_OPERATOR_TYPE_UNTIL) {
        return attributeVal <= value
      } else if (operator === RULE_OPERATOR_TYPE_AFTER) {
        return attributeVal > value
      } else if (operator === RULE_OPERATOR_TYPE_BEFORE) {
        return attributeVal < value
      } else {
        return false
      }
    } else if (attributeType === OBJECT_ATTRIBUTE_TYPE_DATETIME) {
      value = value && (new Date(value)).getTime()
      valueList = valueList && valueList.map(v => (new Date(v)).getTime())

      attributeVal = (new Date(attributeVal)).getTime()

      if (isNaN(attributeVal)) {
        return false
      }

      if (operator === RULE_OPERATOR_TYPE_IS) {
        return attributeVal === value
      } else if (operator === RULE_OPERATOR_TYPE_IS_NOT) {
        return attributeVal !== value
      } else if (operator === RULE_OPERATOR_TYPE_IN) {
        return valueList.indexOf(attributeVal) >= 0
      } else if (operator === RULE_OPERATOR_TYPE_NOT_IN) {
        return valueList.indexOf(attributeVal) === -1
      } else if (operator === RULE_OPERATOR_TYPE_FROM) {
        return attributeVal >= value
      } else if (operator === RULE_OPERATOR_TYPE_UNTIL) {
        return attributeVal <= value
      } else if (operator === RULE_OPERATOR_TYPE_AFTER) {
        return attributeVal > value
      } else if (operator === RULE_OPERATOR_TYPE_BEFORE) {
        return attributeVal < value
      } else {
        return false
      }
    } else {
      return false
    }
  }

  _getGateValuesForObject = (controlInfo, object) => {
    if (controlInfo.enablementsInfo[object.type] !== undefined) {
      if (controlInfo.enablementsInfo[object.type][object.id] !== undefined) {
        let [isEnabled, variation] = controlInfo.enablementsInfo[object.type][object.id]
        return {
          isEnabled,
          variation,
          isEligible: isEnabled,
          _fromEnablement: true,
        }
      }
    }

    let sampledInsideBasePopulation = false
    for (let i = 0; i < controlInfo.ruleSets.length; i++) {
      if (sampledInsideBasePopulation) {
        break
      }
      let ruleSet = controlInfo.ruleSets[i]
      let rules = ruleSet.rules

      if (ruleSet.clientObjectTypeName !== object.type) {
        continue
      }

      let satisfiesAllRules = true
      for (let j = 0; j < rules.length; j++) {
        let rule = rules[j]
        satisfiesAllRules = satisfiesAllRules && this._satisfiesRule(rule, object)
      }

      if (satisfiesAllRules) {
        let hashKey = `SAMPLING:control_${controlInfo.id}:env_${this.gatingInfo.env.id}:rule_set_${ruleSet.id}:client_object_${object.type}_${object.id}`
        if (getHashedValue(hashKey) <= ruleSet.samplingPercentage) {
          sampledInsideBasePopulation = true
        }
      }
    }

    if (!sampledInsideBasePopulation) {
      return {
        isEnabled: false,
        variation: null,
        isEligible: false,
      }
    }

    if (controlInfo.type === CONTROL_TYPE_BOOLEAN) {
      return {
        isEnabled: true,
        variation: null,
        isEligible: true,
      }
    } else if (controlInfo.type === CONTROL_TYPE_MULTIVARIATE) {
      if (controlInfo.distributions.length === 0) {
        return {
          isEnabled: true,
          variation: controlInfo.defaultVariation,
          isEligible: true,
        }
      }

      let percentageBasedDistributions = controlInfo.distributions.filter(d => d.type === DISTRIBUTION_TYPE_PERCENTAGE_BASED)
      let ruleBasedDistributions = controlInfo.distributions.filter(d => d.type === DISTRIBUTION_TYPE_RULE_BASED)

      if (percentageBasedDistributions.length !== 0 && ruleBasedDistributions.length !== 0) {
        console.error('Rule integrity error: please contact support@airshiphq.com')
        return {
          isEnabled: false,
          variation: null,
          isEligible: false,
        }
      }

      if (percentageBasedDistributions.length !== 0) {
        let delta = 0.0001
        let sum_percentages = 0.0
        let running_percentages = []
        for (let i = 0; i < percentageBasedDistributions.length; i++) {
          let distribution = percentageBasedDistributions[i]
          sum_percentages += distribution.percentage
          if (running_percentages.length === 0) {
            running_percentages.push(distribution.percentage)
          } else {
            running_percentages.push(running_percentages[running_percentages.length - 1] + distribution.percentage)
          }
        }

        if (Math.abs(1.0 - sum_percentages) > delta) {
          console.error('Rule integrity error: please contact support@airshiphq.com')
          return {
            isEnabled: false,
            variation: null,
            isEligible: false,
          }
        }

        let hashKey = `DISTRIBUTION:control_${controlInfo.id}:env_${this.gatingInfo.env.id}:client_object_${object.type}_${object.id}`
        let hashedPercentage = getHashedValue(hashKey)

        for (let i = 0; i < running_percentages.length; i++) {
          let percentage = running_percentages[i]
          if (hashedPercentage <= percentage) {
            return {
              isEnabled: true,
              variation: percentageBasedDistributions[i].variation,
              isEligible: true,
            }
          }
        }

        return {
          isEnabled: true,
          variation: percentageBasedDistributions[percentageBasedDistributions.length - 1].variation,
          isEligible: true,
        }
      } else {
        for (let i = 0; i < ruleBasedDistributions.length; i++) {
          let distribution = ruleBasedDistributions[i]

          let ruleSet = distribution.ruleSet
          let rules = ruleSet.rules

          if (ruleSet.clientObjectTypeName !== object.type) {
            continue
          }

          let satisfiesAllRules = true
          for (let j = 0; j < rules.length; j++) {
            let rule = rules[j]
            satisfiesAllRules = satisfiesAllRules && this._satisfiesRule(rule, object)
          }

          if (satisfiesAllRules) {
            return {
              isEnabled: true,
              variation: distribution.variation,
              isEligible: true,
            }
          }
        }

        return {
          isEnabled: true,
          variation: controlInfo.ruleBasedDistributionDefaultVariation || controlInfo.defaultVariation,
          isEligible: true,
          _ruleBasedDefaultVariation: true,
        }
      }
    } else {
      return {
        isEnabled: false,
        variation: null,
        isEligible: false,
      }
    }
  }

  _getGateValues = (controlShortName, object) => {
    if (this.gatingInfoMap[controlShortName] === undefined) {
      return {
        isEnabled: false,
        variation: null,
        isEligible: false,
        _shouldSendStats: false,
      }
    }

    let controlInfo = this.gatingInfoMap[controlShortName]

    if (!controlInfo.isOn) {
      return {
        isEnabled: false,
        variation: null,
        isEligible: false,
        _shouldSendStats: true,
      }
    }

    let group = null
    if (object.group !== undefined) {
      group = object.group
    }

    let result = this._getGateValuesForObject(controlInfo, object)

    if (group !== null) {
      if (group.type == undefined) {
        group.type = `${object.type}Group`
        group.isGroup = true
      }
      let groupResult = this._getGateValuesForObject(controlInfo, group)

      if (result._fromEnablement && !result.isEnabled) {
        // Do nothing
      } else if (!result._fromEnablement && groupResult._fromEnablement && !groupResult.isEnabled) {
        result.isEnabled = groupResult.isEnabled
        result.variation = groupResult.variation
        result.isEligible = groupResult.isEligible
      } else if (result.isEnabled) {
        if (result._ruleBasedDefaultVariation) {
          if (groupResult.isEnabled) {
            result.isEnabled = groupResult.isEnabled
            result.variation = groupResult.variation
            result.isEligible = groupResult.isEligible
          } else {
            // Do nothing
          }
        } else {
          // Do nothing
        }
      } else if (groupResult.isEnabled) {
        result.isEnabled = groupResult.isEnabled
        result.variation = groupResult.variation
        result.isEligible = groupResult.isEligible
      } else {
        // Do nothing
      }
    }

    result._shouldSendStats = true
    return result
  }

  _cloneObject = (object) => {
    let clone = Object.assign({}, object)

    if (object.attributes !== undefined) {
      clone.attributes = Object.assign({}, object.attributes)
    }

    if (object.group !== undefined) {
      clone.group = Object.assign({}, object.group)

      if (object.group.attributes !== undefined) {
        clone.group.attributes = Object.assign({}, object.group.attributes)
      }
    }

    return clone
  }

  _validateNesting = (object) => {
    if (object.isGroup === true && object.group !== undefined) {
      return 'A group cannot be nested inside another group'
    }

    return null
  }

  isEnabled = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return false
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return false
    }

    object = this._cloneObject(object)

    let error = this._validateNesting(object)

    if (error) {
      console.error(error)
      return false
    }

    let gateTimestamp = (new Date()).toISOString()

    let start = process.hrtime()
    let { isEnabled, variation, isEligible, _shouldSendStats } = this._getGateValues(controlShortName, object)
    let end = process.hrtime(start)

    if (_shouldSendStats) {
      let sdkGateTimestamp = gateTimestamp
      let sdkGateLatency = `${end[1] / 1000.0}us`
      let sdkVersion = SDK_VERSION

      let stats = {}
      stats.sdkGateControlShortName = controlShortName
      stats.sdkGateTimestamp = sdkGateTimestamp
      stats.sdkGateLatency = sdkGateLatency
      stats.sdkVersion = sdkVersion
      stats.sdkId = SDK_ID

      object.stats = stats

      this._uploadStatsAsync(object)
    }

    return isEnabled
  }

  getVariation = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return null
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return null
    }

    object = this._cloneObject(object)

    let error = this._validateNesting(object)

    if (error) {
      console.error(error)
      return null
    }

    let gateTimestamp = (new Date()).toISOString()

    let start = process.hrtime()
    let { isEnabled, variation, isEligible, _shouldSendStats } = this._getGateValues(object)
    let end = process.hrtime(start)

    if (_shouldSendStats) {
      let sdkGateTimestamp = gateTimestamp
      let sdkGateLatency = `${end[1] / 1000.0}us`
      let sdkVersion = SDK_VERSION

      let stats = {}
      stats.sdkGateControlShortName = controlShortName
      stats.sdkGateTimestamp = sdkGateTimestamp
      stats.sdkGateLatency = sdkGateLatency
      stats.sdkVersion = sdkVersion
      stats.sdkId = SDK_ID

      object.stats = stats

      this._uploadStatsAsync(object)
    }

    return variation
  }

  isEligible = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return false
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return false
    }

    object = this._cloneObject(object)

    let error = this._validateNesting(object)

    if (error) {
      console.error(error)
      return false
    }

    let gateTimestamp = (new Date()).toISOString()

    let start = process.hrtime()
    let { isEnabled, variation, isEligible, _shouldSendStats } = this._getGateValues(object)
    let end = process.hrtime(start)

    if (_shouldSendStats) {
      let sdkGateTimestamp = gateTimestamp
      let sdkGateLatency = `${end[1] / 1000.0}us`
      let sdkVersion = SDK_VERSION

      let stats = {}
      stats.sdkGateControlShortName = controlShortName
      stats.sdkGateTimestamp = sdkGateTimestamp
      stats.sdkGateLatency = sdkGateLatency
      stats.sdkVersion = sdkVersion
      stats.sdkId = SDK_ID

      object.stats = stats

      this._uploadStatsAsync(object)
    }

    return isEligible
  }
}

exports = module.exports = Airship
